import SchemaBuilder from "@pothos/core";

export interface GqlContext {
  user: { id: string; name: string; email: string };
  organization: { id: string; role: string } | null;
}

export const builder = new SchemaBuilder<{ Context: GqlContext }>({});

builder.queryType({});
builder.mutationType({});
