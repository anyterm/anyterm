import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import { GraphQLError, gql } from "../graphql.js";

let server: http.Server;
let baseUrl: string;

// Configurable response for each test
let nextResponse: { status?: number; body: unknown };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());

      // Store request info for assertions
      (server as unknown as Record<string, unknown>).__lastRequest = {
        url: req.url,
        method: req.method,
        headers: req.headers,
        body,
      };

      const status = nextResponse.status ?? 200;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(nextResponse.body));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function getLastRequest() {
  return (server as unknown as Record<string, unknown>).__lastRequest as {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: { query: string; variables?: Record<string, unknown> };
  };
}

describe("GraphQLError", () => {
  it("extends Error and stores errors array", () => {
    const errors = [
      { message: "Field not found", extensions: { code: "BAD_REQUEST" } },
      { message: "Another error" },
    ];
    const err = new GraphQLError("Field not found", errors);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GraphQLError);
    expect(err.name).toBe("GraphQLError");
    expect(err.message).toBe("Field not found");
    expect(err.errors).toBe(errors);
    expect(err.errors).toHaveLength(2);
  });
});

describe("gql()", () => {
  it("sends correct request format", async () => {
    nextResponse = { body: { data: { sessions: [] } } };

    await gql(baseUrl, "my-token", "{ sessions { id } }");

    const req = getLastRequest();
    expect(req.url).toBe("/api/graphql");
    expect(req.method).toBe("POST");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["authorization"]).toBe("Bearer my-token");
    expect(req.body.query).toBe("{ sessions { id } }");
    expect(req.body.variables).toBeUndefined();
  });

  it("passes variables when provided", async () => {
    nextResponse = { body: { data: { session: { id: "abc" } } } };

    await gql(baseUrl, "tok", "query ($id: String!) { session(id: $id) { id } }", {
      id: "abc",
    });

    const req = getLastRequest();
    expect(req.body.variables).toEqual({ id: "abc" });
  });

  it("throws GraphQLError when server returns errors", async () => {
    nextResponse = {
      body: {
        errors: [{ message: "Unauthorized", extensions: { code: "UNAUTHORIZED" } }],
      },
    };

    await expect(
      gql(baseUrl, "bad-token", "{ sessions { id } }"),
    ).rejects.toThrow(GraphQLError);

    nextResponse = {
      body: {
        errors: [{ message: "Unauthorized" }],
      },
    };

    try {
      await gql(baseUrl, "bad-token", "{ sessions { id } }");
    } catch (err) {
      expect(err).toBeInstanceOf(GraphQLError);
      expect((err as GraphQLError).errors).toHaveLength(1);
      expect((err as GraphQLError).errors[0].message).toBe("Unauthorized");
    }
  });

  it("returns data when errors array is empty", async () => {
    nextResponse = {
      body: { data: { userKeys: { publicKey: "abc" } }, errors: [] },
    };

    const result = await gql<{ userKeys: { publicKey: string } }>(
      baseUrl,
      "tok",
      "{ userKeys { publicKey } }",
    );

    expect(result.userKeys.publicKey).toBe("abc");
  });
});
