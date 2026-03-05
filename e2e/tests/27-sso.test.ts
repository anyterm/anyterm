import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";

describe("SSO Providers", () => {
  let admin: RegisteredUser;
  let apiAdmin: ApiClient;
  const testProviderId = `test-sso-${Date.now()}`;

  beforeAll(async () => {
    admin = await registerUser();
    apiAdmin = new ApiClient(admin.cookieToken);
  });

  it("registers an OIDC provider", async () => {
    const { status, body } = await apiAdmin.registerSSOProvider({
      providerId: testProviderId,
      domain: "e2e-test.example.com",
      issuer: "https://accounts.google.com",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("lists registered providers", async () => {
    const { status, body } = await apiAdmin.getSSOProviders();

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const providers = body.data as Array<{
      providerId: string;
      domain: string;
      issuer: string;
    }>;
    const found = providers.find((p) => p.providerId === testProviderId);
    expect(found).toBeDefined();
    expect(found!.domain).toBe("e2e-test.example.com");
    expect(found!.issuer).toBe("https://accounts.google.com");
  });

  it("deletes a provider", async () => {
    const { status, body } = await apiAdmin.deleteSSOProvider(testProviderId);

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // Verify it's gone
    const { body: listBody } = await apiAdmin.getSSOProviders();
    const providers = listBody.data as Array<{ providerId: string }>;
    const found = providers.find((p) => p.providerId === testProviderId);
    expect(found).toBeUndefined();
  });

  it("generates activity logs for SSO operations", async () => {
    const secondProviderId = `test-sso-audit-${Date.now()}`;

    // Register and delete to generate activity
    await apiAdmin.registerSSOProvider({
      providerId: secondProviderId,
      domain: "audit-test.example.com",
      issuer: "https://accounts.google.com",
      clientId: "test-id",
      clientSecret: "test-secret",
    });
    await apiAdmin.deleteSSOProvider(secondProviderId);

    // Wait for fire-and-forget writes
    await new Promise((r) => setTimeout(r, 500));

    const { body } = await apiAdmin.getActivityLogs();
    const logs = body.data as Array<{ action: string; target: string | null }>;

    const createLog = logs.find(
      (l) => l.action === "sso.provider.create" && l.target === secondProviderId,
    );
    const deleteLog = logs.find(
      (l) => l.action === "sso.provider.delete" && l.target === secondProviderId,
    );
    expect(createLog).toBeDefined();
    expect(deleteLog).toBeDefined();
  });

  it("rejects invalid provider ID format", async () => {
    const { status, body } = await apiAdmin.registerSSOProvider({
      providerId: "INVALID_ID!!",
      domain: "test.example.com",
      issuer: "https://accounts.google.com",
      clientId: "test",
      clientSecret: "test",
    });

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });
});
