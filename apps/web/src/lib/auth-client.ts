"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields, organizationClient, lastLoginMethodClient } from "better-auth/client/plugins";
import { stripeClient } from "@better-auth/stripe/client";
import { ssoClient } from "@better-auth/sso/client";
import type { auth } from "./auth";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  plugins: [
    inferAdditionalFields<typeof auth>(),
    organizationClient(),
    lastLoginMethodClient(),
    stripeClient({ subscription: true }),
    ssoClient(),
  ],
});
