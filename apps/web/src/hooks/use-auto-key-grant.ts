"use client";

import { useEffect, useRef } from "react";
import { gql } from "urql";
import { urqlClient } from "@/lib/urql";
import { USER_KEYS_QUERY, ORG_KEYS_QUERY } from "@/lib/graphql-queries";
import {
  fromBase64,
  toBase64,
  decryptPrivateKey,
  sealOrgPrivateKey,
  unsealOrgPrivateKey,
} from "@anyterm/utils/crypto";

const PENDING_KEY_GRANTS_QUERY = gql`
  query { pendingKeyGrants { memberId userId publicKey } }
`;

const GRANT_ORG_KEY_MUTATION = gql`
  mutation GrantOrgKey($memberId: String!, $encryptedOrgPrivateKey: String!) {
    grantOrgKey(memberId: $memberId, encryptedOrgPrivateKey: $encryptedOrgPrivateKey)
  }
`;

const POLL_INTERVAL = 10_000;

export function useAutoKeyGrant() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function grantKeys() {
      try {
        // Check if we have a masterKey in sessionStorage
        const storedMk = sessionStorage.getItem("anyterm_master_key");
        if (!storedMk) return;

        // Check if there are pending grants
        const { data: pendingData } = await urqlClient
          .query(PENDING_KEY_GRANTS_QUERY, {})
          .toPromise();

        const pending = pendingData?.pendingKeyGrants;
        if (!pending || pending.length === 0) return;

        // Get org keys
        const { data: orgKeysData } = await urqlClient
          .query(ORG_KEYS_QUERY, {})
          .toPromise();

        if (!orgKeysData?.orgKeys) return;
        const { orgPublicKey, encryptedOrgPrivateKey, isPersonalOrg } = orgKeysData.orgKeys;

        // Personal orgs don't need key grants
        if (isPersonalOrg) return;
        if (!orgPublicKey || !encryptedOrgPrivateKey) return;

        // Decrypt our own keys to get the org private key
        const masterKey = fromBase64(storedMk);

        const { data: userKeysData } = await urqlClient
          .query(USER_KEYS_QUERY, {})
          .toPromise();

        if (!userKeysData?.userKeys) return;
        const { publicKey: userPubKeyB64, encryptedPrivateKey: encPkB64 } = userKeysData.userKeys;
        if (!userPubKeyB64 || !encPkB64) return;

        const userPublicKey = fromBase64(userPubKeyB64);
        const userPrivateKey = await decryptPrivateKey(fromBase64(encPkB64), masterKey);

        // Unseal the org private key
        const orgPrivateKey = unsealOrgPrivateKey(
          fromBase64(encryptedOrgPrivateKey),
          userPublicKey,
          userPrivateKey,
        );

        // Grant key to each pending member
        for (const grant of pending) {
          const memberPublicKey = fromBase64(grant.publicKey);
          const sealed = sealOrgPrivateKey(orgPrivateKey, memberPublicKey);

          await urqlClient
            .mutation(GRANT_ORG_KEY_MUTATION, {
              memberId: grant.memberId,
              encryptedOrgPrivateKey: toBase64(sealed),
            })
            .toPromise();
        }
      } catch {
        // Silent failure — retry on next interval
      }
    }

    // Run immediately, then on interval
    grantKeys();
    timerRef.current = setInterval(grantKeys, POLL_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);
}
