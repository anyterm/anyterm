import { getEnv } from "./env.js";

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export class ApiClient {
  private baseUrl: string;
  private cookieToken: string;

  /**
   * @param cookieToken - Full signed cookie token (token.hmac) for better-auth getSession
   */
  constructor(cookieToken: string) {
    this.baseUrl = getEnv().baseUrl;
    this.cookieToken = cookieToken;
  }

  private authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Cookie: `better-auth.session_token=${this.cookieToken}`,
    };
  }

  private async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<{ status: number; body: ApiResponse<T> }> {
    const res = await fetch(`${this.baseUrl}/api/graphql`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ query, variables }),
    });

    const json = await res.json();

    if (json.errors?.length) {
      const err = json.errors[0];
      const code = err.extensions?.code;
      let status = 400;
      if (code === "UNAUTHORIZED") status = 401;
      else if (err.message === "Session not found") status = 404;
      return { status, body: { success: false, error: err.message } };
    }

    return { status: 200, body: { success: true, data: json.data as T } };
  }

  // --- User Keys ---

  async getKeys() {
    const result = await this.graphql<{
      userKeys: {
        publicKey: string;
        encryptedPrivateKey: string;
        keySalt: string;
      } | null;
    }>(`query { userKeys { publicKey encryptedPrivateKey keySalt } }`);

    if (result.body.success && result.body.data) {
      const keys = (result.body.data as { userKeys: { publicKey: string; encryptedPrivateKey: string; keySalt: string } | null }).userKeys;
      if (!keys) {
        return { status: 404, body: { success: false, error: "Not found" } as ApiResponse<{ publicKey: string; encryptedPrivateKey: string; keySalt: string }> };
      }
      return { status: 200, body: { success: true, data: keys } as ApiResponse<{ publicKey: string; encryptedPrivateKey: string; keySalt: string }> };
    }

    return result as { status: number; body: ApiResponse<{ publicKey: string; encryptedPrivateKey: string; keySalt: string }> };
  }

  // --- Sessions ---

  async createSession(data: {
    name: string;
    command: string;
    encryptedSessionKey: string;
    cols?: number;
    rows?: number;
    forwardedPorts?: string;
  }) {
    const result = await this.graphql<{ createSession: Record<string, unknown> }>(`
      mutation ($input: CreateSessionInput!) {
        createSession(input: $input) {
          id userId name command status encryptedSessionKey
          cols rows forwardedPorts createdAt endedAt
        }
      }
    `, { input: data });

    if (result.body.success && result.body.data) {
      const session = (result.body.data as { createSession: Record<string, unknown> }).createSession;
      return { status: 200, body: { success: true, data: session } as ApiResponse<Record<string, unknown>> };
    }
    return result as { status: number; body: ApiResponse<Record<string, unknown>> };
  }

  async listSessions() {
    const result = await this.graphql<{ sessions: Record<string, unknown>[] }>(`
      query {
        sessions {
          id userId name command status encryptedSessionKey
          cols rows forwardedPorts createdAt endedAt
        }
      }
    `);

    if (result.body.success && result.body.data) {
      const sessions = (result.body.data as { sessions: Record<string, unknown>[] }).sessions;
      return { status: 200, body: { success: true, data: sessions } as ApiResponse<Record<string, unknown>[]> };
    }
    return result as { status: number; body: ApiResponse<Record<string, unknown>[]> };
  }

  async getSession(id: string) {
    const result = await this.graphql<{ session: Record<string, unknown> | null }>(`
      query ($id: String!) {
        session(id: $id) {
          id userId name command status encryptedSessionKey
          cols rows forwardedPorts createdAt endedAt
          snapshotSeq snapshotData agentType
        }
      }
    `, { id });

    if (result.body.success && result.body.data) {
      const session = (result.body.data as { session: Record<string, unknown> | null }).session;
      if (!session) {
        return { status: 404, body: { success: false, error: "Not found" } as ApiResponse<Record<string, unknown>> };
      }
      return { status: 200, body: { success: true, data: session } as ApiResponse<Record<string, unknown>> };
    }
    return result as { status: number; body: ApiResponse<Record<string, unknown>> };
  }

  async updateSession(id: string, data: Record<string, unknown>) {
    const result = await this.graphql<{ updateSession: Record<string, unknown> | null }>(`
      mutation ($input: UpdateSessionInput!) {
        updateSession(input: $input) {
          id userId name command status encryptedSessionKey
          cols rows forwardedPorts createdAt endedAt
        }
      }
    `, { input: { id, ...data } });

    if (result.body.success && result.body.data) {
      const session = (result.body.data as { updateSession: Record<string, unknown> | null }).updateSession;
      if (!session) {
        return { status: 404, body: { success: false, error: "Not found" } as ApiResponse<Record<string, unknown>> };
      }
      return { status: 200, body: { success: true, data: session } as ApiResponse<Record<string, unknown>> };
    }
    return result as { status: number; body: ApiResponse<Record<string, unknown>> };
  }

  async deleteSession(id: string) {
    const result = await this.graphql<{ deleteSession: boolean }>(`
      mutation ($id: String!) {
        deleteSession(id: $id)
      }
    `, { id });

    if (result.body.success) {
      return { status: 200, body: { success: true } as ApiResponse };
    }
    return result as { status: number; body: ApiResponse };
  }

  // --- Chunks ---

  async storeChunks(
    sessionId: string,
    chunks: Array<{ seq: number; data: string }>,
  ) {
    const result = await this.graphql<{ storeChunks: boolean }>(`
      mutation ($sessionId: String!, $chunks: [ChunkInput!]!) {
        storeChunks(sessionId: $sessionId, chunks: $chunks)
      }
    `, { sessionId, chunks });

    if (result.body.success) {
      return { status: 200, body: { success: true } as ApiResponse };
    }
    return result as { status: number; body: ApiResponse };
  }

  async getChunks(
    sessionId: string,
    options?: { after?: number; limit?: number },
  ) {
    const result = await this.graphql<{ chunks: Array<Record<string, unknown>> }>(`
      query ($sessionId: String!, $after: Int!, $limit: Int!) {
        chunks(sessionId: $sessionId, after: $after, limit: $limit) {
          id sessionId seq data timestamp
        }
      }
    `, {
      sessionId,
      after: options?.after ?? 0,
      limit: options?.limit ?? 1000,
    });

    if (result.body.success && result.body.data) {
      const chunks = (result.body.data as { chunks: Array<Record<string, unknown>> }).chunks;
      return { status: 200, body: { success: true, data: chunks } as ApiResponse<Array<Record<string, unknown>>> };
    }
    return result as { status: number; body: ApiResponse<Array<Record<string, unknown>>> };
  }

  // --- Org Keys ---

  async getOrgKeys() {
    const result = await this.graphql<{
      orgKeys: {
        orgPublicKey: string | null;
        encryptedOrgPrivateKey: string | null;
        isPersonalOrg: boolean;
      };
    }>(`query { orgKeys { orgPublicKey encryptedOrgPrivateKey isPersonalOrg } }`);

    if (result.body.success && result.body.data) {
      return {
        status: 200,
        body: { success: true, data: (result.body.data as any).orgKeys },
      };
    }
    return result;
  }

  async setOrgKeys(publicKey: string, encryptedOrgPrivateKey: string) {
    return this.graphql<{ setOrgKeys: boolean }>(`
      mutation ($publicKey: String!, $encryptedOrgPrivateKey: String!) {
        setOrgKeys(publicKey: $publicKey, encryptedOrgPrivateKey: $encryptedOrgPrivateKey)
      }
    `, { publicKey, encryptedOrgPrivateKey });
  }

  async getPendingKeyGrants() {
    const result = await this.graphql<{
      pendingKeyGrants: Array<{ memberId: string; userId: string; publicKey: string }>;
    }>(`query { pendingKeyGrants { memberId userId publicKey } }`);

    if (result.body.success && result.body.data) {
      return {
        status: 200,
        body: { success: true, data: (result.body.data as any).pendingKeyGrants },
      };
    }
    return result;
  }

  async grantOrgKey(memberId: string, encryptedOrgPrivateKey: string) {
    return this.graphql<{ grantOrgKey: boolean }>(`
      mutation ($memberId: String!, $encryptedOrgPrivateKey: String!) {
        grantOrgKey(memberId: $memberId, encryptedOrgPrivateKey: $encryptedOrgPrivateKey)
      }
    `, { memberId, encryptedOrgPrivateKey });
  }

  // --- Activity Logs ---

  async getActivityLogs(limit?: number) {
    const result = await this.graphql<{
      activityLogs: Array<{
        id: string;
        action: string;
        target: string | null;
        detail: string | null;
        userName: string | null;
        createdAt: string;
      }>;
    }>(`
      query ($limit: Int) {
        activityLogs(limit: $limit) {
          id action target detail userName createdAt
        }
      }
    `, { limit: limit ?? 50 });

    if (result.body.success && result.body.data) {
      return {
        status: 200,
        body: { success: true, data: (result.body.data as any).activityLogs },
      };
    }
    return result;
  }

  // --- SSO Providers ---

  async getSSOProviders() {
    const result = await this.graphql<{
      ssoProviders: Array<{
        id: string;
        providerId: string;
        domain: string;
        issuer: string;
        organizationId: string | null;
      }>;
    }>(`
      query {
        ssoProviders {
          id providerId domain issuer organizationId
        }
      }
    `);

    if (result.body.success && result.body.data) {
      return {
        status: 200,
        body: { success: true, data: (result.body.data as any).ssoProviders },
      };
    }
    return result;
  }

  async registerSSOProvider(input: {
    providerId: string;
    domain: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    discoveryEndpoint?: string;
  }) {
    return this.graphql<{ registerSSOProvider: boolean }>(`
      mutation (
        $providerId: String!,
        $domain: String!,
        $issuer: String!,
        $clientId: String!,
        $clientSecret: String!,
        $discoveryEndpoint: String
      ) {
        registerSSOProvider(
          providerId: $providerId,
          domain: $domain,
          issuer: $issuer,
          clientId: $clientId,
          clientSecret: $clientSecret,
          discoveryEndpoint: $discoveryEndpoint
        )
      }
    `, input);
  }

  async deleteSSOProvider(providerId: string) {
    return this.graphql<{ deleteSSOProvider: boolean }>(`
      mutation ($providerId: String!) {
        deleteSSOProvider(providerId: $providerId)
      }
    `, { providerId });
  }

  // --- Plan ---

  async getCurrentPlan() {
    const result = await this.graphql<{ currentPlan: string | null }>(
      `query { currentPlan }`,
    );

    if (result.body.success && result.body.data) {
      return {
        status: 200,
        body: {
          success: true,
          data: (result.body.data as { currentPlan: string | null }).currentPlan,
        },
      };
    }
    return result;
  }

  // --- User Key Update ---

  async updateUserKeys(data: {
    encryptedPrivateKey: string;
    keySalt: string;
    currentPassword: string;
  }) {
    return this.graphql<{ updateUserKeys: boolean }>(`
      mutation ($encryptedPrivateKey: String!, $keySalt: String!, $currentPassword: String!) {
        updateUserKeys(
          encryptedPrivateKey: $encryptedPrivateKey,
          keySalt: $keySalt,
          currentPassword: $currentPassword
        )
      }
    `, data);
  }

  // --- Encryption Key Setup ---

  async setupEncryptionKeys(data: {
    publicKey: string;
    encryptedPrivateKey: string;
    keySalt: string;
  }) {
    return this.graphql<{ setupEncryptionKeys: boolean }>(`
      mutation ($publicKey: String!, $encryptedPrivateKey: String!, $keySalt: String!) {
        setupEncryptionKeys(
          publicKey: $publicKey,
          encryptedPrivateKey: $encryptedPrivateKey,
          keySalt: $keySalt
        )
      }
    `, data);
  }

  // --- Static: unauthenticated requests ---

  static async rawFetch(
    path: string,
    options: RequestInit = {},
  ): Promise<{ status: number; body: unknown }> {
    const { baseUrl } = getEnv();
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }
}
