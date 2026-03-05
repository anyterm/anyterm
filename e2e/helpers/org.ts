import { getEnv } from "./env.js";
import type { RegisteredUser } from "./auth.js";

/**
 * Create a non-personal org, invite + add a member.
 * Returns the org ID.
 */
export async function createOrgWithMember(
  owner: RegisteredUser,
  invitee: RegisteredUser,
  role: "admin" | "member",
): Promise<string> {
  const { baseUrl } = getEnv();

  function ownerHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Cookie: `better-auth.session_token=${owner.cookieToken}`,
    };
  }

  function inviteeHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Cookie: `better-auth.session_token=${invitee.cookieToken}`,
    };
  }

  // 1. Create org
  const createRes = await fetch(`${baseUrl}/api/auth/organization/create`, {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      name: `Test Org ${Date.now()}`,
      slug: `test-org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Org creation failed: ${createRes.status} ${await createRes.text()}`);
  }
  const orgData = await createRes.json();
  const orgId: string = orgData.id;

  // 2. Activate org for owner
  await fetch(`${baseUrl}/api/auth/organization/set-active`, {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({ organizationId: orgId }),
  });

  // 3. Invite member — capture invitation ID from response
  const inviteRes = await fetch(`${baseUrl}/api/auth/organization/invite-member`, {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      email: invitee.email,
      role,
      organizationId: orgId,
    }),
  });
  const inviteData = await inviteRes.json();
  const invitationId: string | undefined = inviteData?.id;

  // 4. Accept invitation
  if (invitationId) {
    await fetch(`${baseUrl}/api/auth/organization/accept-invitation`, {
      method: "POST",
      headers: inviteeHeaders(),
      body: JSON.stringify({ invitationId }),
    });
  }

  // 5. Fallback: list invitations for invitee and accept any pending ones
  const invListRes = await fetch(
    `${baseUrl}/api/auth/organization/list-invitations`,
    { headers: inviteeHeaders() },
  );
  if (invListRes.ok) {
    const text = await invListRes.text();
    try {
      const invitations = JSON.parse(text);
      if (Array.isArray(invitations)) {
        for (const inv of invitations) {
          if (inv.organizationId === orgId && inv.status === "pending") {
            await fetch(`${baseUrl}/api/auth/organization/accept-invitation`, {
              method: "POST",
              headers: inviteeHeaders(),
              body: JSON.stringify({ invitationId: inv.id }),
            });
          }
        }
      }
    } catch {
      // Not JSON — ignore
    }
  }

  // 6. Activate org for invitee
  await fetch(`${baseUrl}/api/auth/organization/set-active`, {
    method: "POST",
    headers: inviteeHeaders(),
    body: JSON.stringify({ organizationId: orgId }),
  });

  // 7. Verify invitee actually has the org active
  const verifyRes = await fetch(`${baseUrl}/api/auth/organization/get-full-organization`, {
    headers: inviteeHeaders(),
  });
  if (verifyRes.ok) {
    const fullOrg = await verifyRes.json();
    if (fullOrg?.id !== orgId) {
      // Try once more to set active
      await fetch(`${baseUrl}/api/auth/organization/set-active`, {
        method: "POST",
        headers: inviteeHeaders(),
        body: JSON.stringify({ organizationId: orgId }),
      });
    }
  }

  return orgId;
}

/**
 * Set active org for a user.
 */
export async function setActiveOrg(
  user: RegisteredUser,
  orgId: string,
): Promise<void> {
  const { baseUrl } = getEnv();
  await fetch(`${baseUrl}/api/auth/organization/set-active`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `better-auth.session_token=${user.cookieToken}`,
    },
    body: JSON.stringify({ organizationId: orgId }),
  });
}
