import Stripe from "stripe";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { bearer, organization, lastLoginMethod } from "better-auth/plugins";
import { stripe } from "@better-auth/stripe";
import { sso } from "@better-auth/sso";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { members } from "@anyterm/db";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "./email";
import { jsx } from "react/jsx-runtime";
import VerifyEmail from "@/emails/verify-email";
import ResetPassword from "@/emails/reset-password";
import OrgInvitation from "@/emails/org-invitation";

function buildPlugins(): BetterAuthPlugin[] {
  const plugins: BetterAuthPlugin[] = [
    bearer(),
    lastLoginMethod(),
    organization({
      allowUserToCreateOrganization: true,
      async sendInvitationEmail(data) {
        const inviteLink = `${process.env.BETTER_AUTH_URL || "http://localhost:3000"}/accept-invitation/${data.id}`;
        void sendEmail({
          to: data.email,
          subject: `Join ${data.organization.name} on anyterm`,
          react: jsx(OrgInvitation, {
            inviterName: data.inviter.user.name,
            orgName: data.organization.name,
            role: data.role as string,
            url: inviteLink,
          }),
        });
      },
    }),
    sso(),
  ];

  if (process.env.STRIPE_SECRET_KEY) {
    const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);

    plugins.push(
      stripe({
        stripeClient,
        stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
        createCustomerOnSignUp: true,
        subscription: {
          enabled: true,
          plans: [
            {
              name: "pro",
              priceId: process.env.STRIPE_PRO_PRICE_ID!,
              limits: {
                maxSessionsPerUser: 3,
                maxSessionsPerOrg: 10,
                maxStorageGB: 50,
                retentionDays: 7,
              },
            },
            {
              name: "team",
              priceId: process.env.STRIPE_TEAM_PRICE_ID!,
              limits: {
                maxSessionsPerUser: 10,
                maxSessionsPerOrg: 100,
                maxStorageGB: 200,
                retentionDays: 30,
              },
            },
          ],
          authorizeReference: async ({ user, referenceId }) => {
            // referenceId is now organizationId — check user is a member of that org
            const [member] = await db
              .select({ id: members.id })
              .from(members)
              .where(
                and(
                  eq(members.organizationId, referenceId),
                  eq(members.userId, user.id),
                ),
              )
              .limit(1);
            return !!member;
          },
        },
        organization: { enabled: true },
      }),
    );
  }

  return plugins;
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
  }),
  rateLimit: {
    enabled: process.env.DISABLE_RATE_LIMIT !== "1",
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      void sendEmail({
        to: user.email,
        subject: "Reset your password",
        react: jsx(ResetPassword, { url, email: user.email }),
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      void sendEmail({
        to: user.email,
        subject: "Verify your email",
        react: jsx(VerifyEmail, { url }),
      });
    },
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
  },
  socialProviders: {
    ...(process.env.GITHUB_CLIENT_ID && {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    }),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh every 24h
  },
  trustedOrigins: [
    process.env.BETTER_AUTH_URL || "http://localhost:3000",
    ...(process.env.MOBILE_ORIGIN ? [process.env.MOBILE_ORIGIN] : []),
    ...(process.env.NEXT_PUBLIC_PREVIEW_ORIGIN ? [process.env.NEXT_PUBLIC_PREVIEW_ORIGIN] : []),
  ],
  plugins: buildPlugins(),
  user: {
    additionalFields: {
      publicKey: { type: "string", required: false, input: true },
      encryptedPrivateKey: { type: "string", required: false, input: true },
      keySalt: { type: "string", required: false, input: true },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Auto-create personal organization on signup
          // slug === userId convention makes it deterministic and identifiable
          try {
            const { nanoid } = await import("nanoid");
            const orgId = nanoid(12);
            const memberId = nanoid(12);
            const { organizations, members } = await import("@anyterm/db");

            await db.insert(organizations).values({
              id: orgId,
              name: `${user.name}'s Space`,
              slug: user.id,
              createdAt: new Date(),
              // Personal org uses user's publicKey as org publicKey
              publicKey: (user as any).publicKey ?? null,
            });

            await db.insert(members).values({
              id: memberId,
              userId: user.id,
              organizationId: orgId,
              role: "owner",
              createdAt: new Date(),
              // Personal org: no encryptedOrgPrivateKey needed — user's own keypair is the org keypair
            });
          } catch (err) {
            console.error("Failed to create personal organization:", err);
          }
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
