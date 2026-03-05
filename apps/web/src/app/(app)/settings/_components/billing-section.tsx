"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useSubscription } from "@/lib/subscription-context";
import { PLAN_LIMITS, type PlanTier } from "@/lib/plan-limits";

const TIER_DISPLAY: Record<PlanTier, { label: string; color: string }> = {
  starter: { label: "No Plan", color: "text-zinc-400 bg-zinc-500/10" },
  pro: { label: "Pro", color: "text-green-400 bg-green-500/10" },
  team: { label: "Team", color: "text-blue-400 bg-blue-500/10" },
};

const ALL_TIERS: PlanTier[] = ["pro", "team"];

const TIER_PRICES: Record<PlanTier, string> = {
  starter: "No Plan",
  pro: "$12/user/mo",
  team: "$29/user/mo",
};

export function BillingSection({ orgId }: { orgId?: string }) {
  const { planName, loading } = useSubscription();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  async function handleCheckout(slug: string) {
    if (!orgId) return;
    setCheckoutLoading(slug);
    try {
      await (authClient as any).subscription.upgrade({
        plan: slug,
        referenceId: orgId,
        successUrl: `${window.location.origin}/settings?checkout=success`,
        cancelUrl: `${window.location.origin}/settings`,
      });
    } catch {
      setCheckoutLoading(null);
    }
  }

  async function handlePortal() {
    if (!orgId) return;
    setPortalLoading(true);
    try {
      await (authClient as any).subscription.billingPortal({
        referenceId: orgId,
        returnUrl: `${window.location.origin}/settings`,
      });
    } catch {
      setPortalLoading(false);
    }
  }

  function formatLimit(val: number | string): string {
    if (val === "seats") return "10\u00d7seats (max 100)";
    return val === Infinity ? "Unlimited" : String(val);
  }

  return (
    <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-medium">Billing</h3>
        {!loading && planName && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TIER_DISPLAY[planName].color}`}
          >
            {TIER_DISPLAY[planName].label}
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">Loading plan...</div>
      ) : (
        <>
          {planName === "starter" && (
            <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <p className="text-sm text-amber-300">
                You don&apos;t have an active subscription. Subscribe to start using anyterm Cloud.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {ALL_TIERS.map((tier) => {
              const limits = PLAN_LIMITS[tier];
              const isCurrent = planName === tier;
              return (
                <div
                  key={tier}
                  className={`rounded-lg border p-4 ${
                    isCurrent
                      ? "border-green-500/40 bg-green-500/5"
                      : "border-zinc-800 bg-zinc-950/50"
                  }`}
                >
                  <div className="mb-3">
                    <p className="text-sm font-semibold">{TIER_DISPLAY[tier].label}</p>
                    <p className="text-xs text-zinc-400">{TIER_PRICES[tier]}</p>
                  </div>
                  <ul className="space-y-1 text-xs text-zinc-400">
                    <li>{formatLimit(limits.maxSessionsPerUser)} sessions/user</li>
                    <li>{formatLimit(limits.maxSessionsPerOrg)} sessions/org</li>
                    <li>{formatLimit(limits.maxStorageGB)} GB storage</li>
                    <li>{formatLimit(limits.retentionDays)}-day retention</li>
                  </ul>
                  <div className="mt-3">
                    {isCurrent ? (
                      <span className="text-xs text-green-400">Current plan</span>
                    ) : (
                      <button
                        onClick={() => handleCheckout(tier)}
                        disabled={checkoutLoading !== null}
                        className="w-full rounded-md border border-zinc-700 px-2 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                      >
                        {checkoutLoading === tier ? "Redirecting..." : "Subscribe"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {planName && planName !== "starter" && (
            <button
              onClick={handlePortal}
              disabled={portalLoading}
              className="mt-4 text-sm text-zinc-400 underline transition hover:text-white disabled:opacity-50"
            >
              {portalLoading ? "Loading..." : "Manage Billing"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
