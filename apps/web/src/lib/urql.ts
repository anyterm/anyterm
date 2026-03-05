import { cacheExchange, createClient, fetchExchange } from "urql";
import { retryExchange } from "@urql/exchange-retry";
import { authExchange } from "@urql/exchange-auth";

export const urqlClient = createClient({
  url: "/api/graphql",
  preferGetMethod: false,
  requestPolicy: "cache-and-network",
  exchanges: [
    cacheExchange,
    retryExchange({ maxNumberAttempts: 3 }),
    authExchange(async () => ({
      addAuthToOperation: (operation) => operation,
      didAuthError: (error) =>
        error.graphQLErrors.some(
          (e) => e.extensions?.code === "UNAUTHORIZED",
        ),
      refreshAuth: async () => {
        window.location.href = "/login";
      },
    })),
    fetchExchange,
  ],
});
