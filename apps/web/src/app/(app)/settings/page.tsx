"use client";

import { authClient } from "@/lib/auth-client";
import { useSubscription } from "@/lib/subscription-context";
import { PLAN_FEATURES } from "@/lib/plan-limits";
import { AccountSection } from "./_components/account-section";
import { PasswordSection } from "./_components/password-section";
import { EncryptionSection } from "./_components/encryption-section";
import { SSOSection } from "./_components/sso-section";
import { TeamSection } from "./_components/team-section";
import { BillingSection } from "./_components/billing-section";

export default function SettingsPage() {
  const { data: session, isPending } = authClient.useSession();
  const { data: activeOrg } = (authClient as any).useActiveOrganization();
  const { planName } = useSubscription();

  if (isPending) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (!session) return null;

  const isPersonalOrg = activeOrg?.slug === session.user.id;
  const hasSso = planName ? PLAN_FEATURES[planName].sso : false;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h2 className="mb-8 font-display text-2xl font-bold tracking-tight">Settings</h2>

      <div className="space-y-5">
        <BillingSection orgId={activeOrg?.id} />
        {!isPersonalOrg && activeOrg && (
          <TeamSection orgId={activeOrg.id} userId={session.user.id} />
        )}
        {!isPersonalOrg && activeOrg && hasSso && (
          <SSOSection orgId={activeOrg.id} />
        )}
        <AccountSection
          userName={session.user.name}
          userEmail={session.user.email}
        />
        <PasswordSection />
        <EncryptionSection />
      </div>
    </div>
  );
}
