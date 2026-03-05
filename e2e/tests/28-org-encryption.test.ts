import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import { createOrgWithMember, setActiveOrg } from "../helpers/org.js";
import {
  generateKeyPair,
  generateSessionKey,
  encryptSessionKey,
  decryptSessionKey,
  sealOrgPrivateKey,
  unsealOrgPrivateKey,
  toBase64,
  fromBase64,
} from "../helpers/crypto.js";

describe("28 — Org Encryption Flow", () => {
  let owner: RegisteredUser;
  let member: RegisteredUser;
  let ownerApi: ApiClient;
  let memberApi: ApiClient;
  let orgId: string;

  beforeAll(async () => {
    owner = await registerUser();
    member = await registerUser();

    orgId = await createOrgWithMember(owner, member, "member");

    ownerApi = new ApiClient(owner.cookieToken);
    memberApi = new ApiClient(member.cookieToken);
  });

  it("owner setOrgKeys succeeds", async () => {
    const orgKeypair = generateKeyPair();
    const sealedForOwner = sealOrgPrivateKey(
      orgKeypair.privateKey,
      owner.publicKey,
    );

    const res = await ownerApi.setOrgKeys(
      toBase64(orgKeypair.publicKey),
      toBase64(sealedForOwner),
    );
    expect(res.status).toBe(200);

    // Verify org keys are set
    const keys = await ownerApi.getOrgKeys();
    expect(keys.status).toBe(200);
    expect(keys.body.data.orgPublicKey).toBe(toBase64(orgKeypair.publicKey));
    expect(keys.body.data.isPersonalOrg).toBe(false);
  });

  it("second setOrgKeys fails (already configured)", async () => {
    const kp = generateKeyPair();
    const sealed = sealOrgPrivateKey(kp.privateKey, owner.publicKey);
    const res = await ownerApi.setOrgKeys(toBase64(kp.publicKey), toBase64(sealed));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("already configured");
  });

  it("setOrgKeys on personal org fails", async () => {
    // Switch owner back to personal org
    await setActiveOrg(owner, owner.organizationId);

    const personalApi = new ApiClient(owner.cookieToken);
    const kp = generateKeyPair();
    const sealed = sealOrgPrivateKey(kp.privateKey, owner.publicKey);
    const res = await personalApi.setOrgKeys(
      toBase64(kp.publicKey),
      toBase64(sealed),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("personal org");

    // Switch back to team org
    await setActiveOrg(owner, orgId);
  });

  it("member cannot setOrgKeys (requireOrgAdmin)", async () => {
    const kp = generateKeyPair();
    const sealed = sealOrgPrivateKey(kp.privateKey, member.publicKey);
    const res = await memberApi.setOrgKeys(
      toBase64(kp.publicKey),
      toBase64(sealed),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("owners and admins");
  });

  it("pendingKeyGrants returns new member", async () => {
    // Trigger auto-detection by having member query orgKeys
    await memberApi.getOrgKeys();

    const res = await ownerApi.getPendingKeyGrants();
    expect(res.status).toBe(200);
    const grants = res.body.data as Array<{
      memberId: string;
      userId: string;
      publicKey: string;
    }>;
    const memberGrant = grants.find((g) => g.userId === member.userId);
    expect(memberGrant).toBeDefined();
    expect(memberGrant!.publicKey).toBe(toBase64(member.publicKey));
  });

  it("owner grantOrgKey succeeds", async () => {
    const grants = await ownerApi.getPendingKeyGrants();
    const memberGrant = (
      grants.body.data as Array<{
        memberId: string;
        userId: string;
        publicKey: string;
      }>
    ).find((g) => g.userId === member.userId);
    expect(memberGrant).toBeDefined();

    // Owner decrypts org private key, re-seals for member
    const ownerOrgKeys = await ownerApi.getOrgKeys();
    const ownerSealedOrgPk = fromBase64(
      ownerOrgKeys.body.data.encryptedOrgPrivateKey,
    );
    const orgPrivateKey = unsealOrgPrivateKey(
      ownerSealedOrgPk,
      owner.publicKey,
      owner.privateKey,
    );
    const sealedForMember = sealOrgPrivateKey(
      orgPrivateKey,
      fromBase64(memberGrant!.publicKey),
    );

    const res = await ownerApi.grantOrgKey(
      memberGrant!.memberId,
      toBase64(sealedForMember),
    );
    expect(res.status).toBe(200);
  });

  it("member decrypts org private key", async () => {
    const memberOrgKeys = await memberApi.getOrgKeys();
    expect(memberOrgKeys.status).toBe(200);
    expect(memberOrgKeys.body.data.encryptedOrgPrivateKey).toBeTruthy();

    const sealed = fromBase64(memberOrgKeys.body.data.encryptedOrgPrivateKey);
    const orgPrivateKey = unsealOrgPrivateKey(
      sealed,
      member.publicKey,
      member.privateKey,
    );
    expect(orgPrivateKey.length).toBe(32);
  });

  it("member creates session with org publicKey, owner decrypts", async () => {
    const orgKeys = await memberApi.getOrgKeys();
    const orgPublicKey = fromBase64(orgKeys.body.data.orgPublicKey);

    const sessionKey = generateSessionKey();
    const encryptedSessionKey = encryptSessionKey(sessionKey, orgPublicKey);

    const session = await memberApi.createSession({
      name: "org-session",
      command: "echo test",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });
    expect(session.status).toBe(200);

    // Owner decrypts session key
    const ownerOrgKeys = await ownerApi.getOrgKeys();
    const ownerSealedOrgPk = fromBase64(
      ownerOrgKeys.body.data.encryptedOrgPrivateKey,
    );
    const orgPrivateKey = unsealOrgPrivateKey(
      ownerSealedOrgPk,
      owner.publicKey,
      owner.privateKey,
    );
    const decrypted = decryptSessionKey(
      fromBase64((session.body.data as Record<string, string>).encryptedSessionKey),
      orgPublicKey,
      orgPrivateKey,
    );
    expect(decrypted).toEqual(sessionKey);
  });

  it("double grant fails (not pending)", async () => {
    const grants = await ownerApi.getPendingKeyGrants();
    const memberGrant = (
      grants.body.data as Array<{
        memberId: string;
        userId: string;
        publicKey: string;
      }>
    ).find((g) => g.userId === member.userId);

    expect(memberGrant).toBeUndefined();
  });

  it("activity logs include org.keys.setup and org.keys.grant", async () => {
    await new Promise((r) => setTimeout(r, 500));

    const logs = await ownerApi.getActivityLogs(50);
    expect(logs.status).toBe(200);
    const actions = (
      logs.body.data as Array<{ action: string }>
    ).map((l) => l.action);
    expect(actions).toContain("org.keys.setup");
    expect(actions).toContain("org.keys.grant");
  });
});
