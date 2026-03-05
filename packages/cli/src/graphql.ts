export class GraphQLError extends Error {
  constructor(
    message: string,
    public errors: Array<{ message: string; extensions?: Record<string, unknown> }>,
  ) {
    super(message);
    this.name = "GraphQLError";
  }
}

export async function gql<T>(
  serverUrl: string,
  authToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${serverUrl}/api/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  if (json.errors?.length) {
    throw new GraphQLError(json.errors[0].message, json.errors);
  }

  return json.data as T;
}
