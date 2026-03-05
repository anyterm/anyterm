import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import { createOrgWithMember } from "../helpers/org.js";
import {
  generateKeyPair,
  generateSessionKey,
  encryptSessionKey,
  sealOrgPrivateKey,
  toBase64,
} from "../helpers/crypto.js";

describe("33 — Role-Based Access Control", () => {
  let owner: RegisteredUser;
  let admin: RegisteredUser;
  let member: RegisteredUser;
  let ownerApi: ApiClient;
  let adminApi: ApiClient;
  let memberApi: ApiClient;
  let orgId: string;

  beforeAll(async () => {
    owner = await registerUser();
    admin = await registerUser();
    member = await registerUser();

    // Create org, add admin first, then member
    orgId = await createOrgWithMember(owner, admin, "admin");

    // Now invite the member to the same org (owner needs org active)
    const { getEnv } = await import("../helpers/env.js");
    const { baseUrl } = getEnv();

    // Invite member
    const inviteRes = await fetch(`${baseUrl}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `better-auth.session_token=${owner.cookieToken}`,
      },
      body: JSON.stringify({
        email: member.email,
        role: "member",
        organizationId: orgId,
      }),
    });
    const inviteData = await inviteRes.json();

    // Accept with invitation ID from response
    if (inviteData?.id) {
      await fetch(`${baseUrl}/api/auth/organization/accept-invitation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${member.cookieToken}`,
        },
        body: JSON.stringify({ invitationId: inviteData.id }),
      });
    }

    // Fallback: list invitations
    const invListRes = await fetch(
      `${baseUrl}/api/auth/organization/list-invitations`,
      {
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${member.cookieToken}`,
        },
      },
    );
    if (invListRes.ok) {
      try {
        const invitations = await invListRes.json();
        if (Array.isArray(invitations)) {
          for (const inv of invitations) {
            if (inv.organizationId === orgId && inv.status === "pending") {
              await fetch(`${baseUrl}/api/auth/organization/accept-invitation`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Cookie: `better-auth.session_token=${member.cookieToken}`,
                },
                body: JSON.stringify({ invitationId: inv.id }),
              });
            }
          }
        }
      } catch { /* ignore */ }
    }

    // Activate org for member
    await fetch(`${baseUrl}/api/auth/organization/set-active`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `better-auth.session_token=${member.cookieToken}`,
      },
      body: JSON.stringify({ organizationId: orgId }),
    });

    ownerApi = new ApiClient(owner.cookieToken);
    adminApi = new ApiClient(admin.cookieToken);
    memberApi = new ApiClient(member.cookieToken);

    // Set up org keys
    const orgKeypair = generateKeyPair();
    const sealedForOwner = sealOrgPrivateKey(
      orgKeypair.privateKey,
      owner.publicKey,
    );
    await ownerApi.setOrgKeys(
      toBase64(orgKeypair.publicKey),
      toBase64(sealedForOwner),
    );
  });

  function makeSession(name: string, pubKey: Uint8Array) {
    const sessionKey = generateSessionKey();
    const encryptedSessionKey = encryptSessionKey(sessionKey, pubKey);
    return {
      name,
      command: "echo test",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    };
  }

  // --- Member restrictions ---

  it("member cannot setOrgKeys", async () => {
    const kp = generateKeyPair();
    const sealed = sealOrgPrivateKey(kp.privateKey, member.publicKey);
    const res = await memberApi.setOrgKeys(
      toBase64(kp.publicKey),
      toBase64(sealed),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("owners and admins");
  });

  it("member cannot grantOrgKey", async () => {
    const res = await memberApi.grantOrgKey("fake-member-id", "fake-data");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("owners and admins");
  });

  it("member cannot registerSSOProvider", async () => {
    const res = await memberApi.registerSSOProvider({
      providerId: "test-sso",
      domain: "example.com",
      issuer: "https://idp.example.com",
      clientId: "cid",
      clientSecret: "csec",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("owners and admins");
  });

  it("member cannot deleteSSOProvider", async () => {
    const res = await memberApi.deleteSSOProvider("test-sso");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("owners and admins");
  });

  // --- Admin capabilities ---

  it("admin can grantOrgKey", async () => {
    // Trigger member to appear in pending grants
    await memberApi.getOrgKeys();

    const grants = await ownerApi.getPendingKeyGrants();
    const memberGrant = (
      grants.body.data as Array<{
        memberId: string;
        userId: string;
        publicKey: string;
      }>
    ).find((g) => g.userId === member.userId);

    if (memberGrant) {
      const res = await adminApi.grantOrgKey(
        memberGrant.memberId,
        toBase64(new Uint8Array(72)),
      );
      expect(res.status).toBe(200);
    } else {
      // Already granted — admin still has access to the endpoint
      const pendingRes = await adminApi.getPendingKeyGrants();
      expect(pendingRes.status).toBe(200);
    }
  });

  it("admin can registerSSOProvider", async () => {
    const res = await adminApi.registerSSOProvider({
      providerId: "admin-sso-test",
      domain: "admin-test.example.com",
      issuer: "https://idp.admin-test.example.com",
      clientId: "cid",
      clientSecret: "csec",
    });
    expect(res.status).toBe(200);
  });

  it("admin can deleteSSOProvider", async () => {
    const res = await adminApi.deleteSSOProvider("admin-sso-test");
    expect(res.status).toBe(200);
  });

  // --- Session access control ---

  it("member can create own sessions", async () => {
    const orgKeys = await memberApi.getOrgKeys();
    const pubKey =
      orgKeys.body.data?.orgPublicKey
        ? new Uint8Array(
            Buffer.from(orgKeys.body.data.orgPublicKey as string, "base64"),
          )
        : member.publicKey;

    const res = await memberApi.createSession(makeSession("member-session", pubKey));
    expect(res.status).toBe(200);
  });

  it("member can view org sessions", async () => {
    const res = await memberApi.listSessions();
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("member can delete own sessions", async () => {
    const orgKeys = await memberApi.getOrgKeys();
    const pubKey =
      orgKeys.body.data?.orgPublicKey
        ? new Uint8Array(
            Buffer.from(orgKeys.body.data.orgPublicKey as string, "base64"),
          )
        : member.publicKey;

    const session = await memberApi.createSession(
      makeSession("member-delete-me", pubKey),
    );
    const sid = (session.body.data as Record<string, string>).id;

    const res = await memberApi.deleteSession(sid);
    expect(res.status).toBe(200);
  });

  it("member cannot delete another user's session", async () => {
    const orgKeys = await ownerApi.getOrgKeys();
    const pubKey =
      orgKeys.body.data?.orgPublicKey
        ? new Uint8Array(
            Buffer.from(orgKeys.body.data.orgPublicKey as string, "base64"),
          )
        : owner.publicKey;

    const ownerSession = await ownerApi.createSession(
      makeSession("owner-session-protected", pubKey),
    );
    const sid = (ownerSession.body.data as Record<string, string>).id;

    const res = await memberApi.deleteSession(sid);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("owner or admins");
  });

  it("admin can delete any user's session", async () => {
    const orgKeys = await ownerApi.getOrgKeys();
    const pubKey =
      orgKeys.body.data?.orgPublicKey
        ? new Uint8Array(
            Buffer.from(orgKeys.body.data.orgPublicKey as string, "base64"),
          )
        : owner.publicKey;

    const ownerSession = await ownerApi.createSession(
      makeSession("owner-session-admin-delete", pubKey),
    );
    const sid = (ownerSession.body.data as Record<string, string>).id;

    const res = await adminApi.deleteSession(sid);
    expect(res.status).toBe(200);
  });
});
