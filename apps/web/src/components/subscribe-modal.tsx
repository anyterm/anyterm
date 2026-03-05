"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

const PLANS = [
  {
    slug: "pro",
    name: "Pro",
    price: "$12",
    period: "/user/mo",
    note: "$10/user/mo billed annually",
    features: [
      "14-day free trial",
      "3 concurrent sessions",
      "7-day retention",
      "50 GB storage",
      "Priority support",
    ],
    popular: true,
  },
  {
    slug: "team",
    name: "Team",
    price: "$29",
    period: "/user/mo",
    note: "$24/user/mo billed annually · 5-seat min",
    features: [
      "14-day free trial",
      "10 sessions/user, 100/org",
      "30-day retention",
      "SSO, RBAC & audit logs",
      "Audit logs & API",
    ],
    popular: false,
  },
] as const;

export function SubscribeModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const { data: activeOrg } = (authClient as any).useActiveOrganization();

  if (!isOpen) return null;

  async function handleCheckout(slug: string) {
    if (!activeOrg?.id) return;
    setCheckoutLoading(slug);
    try {
      await (authClient as any).subscription.upgrade({
        plan: slug,
        referenceId: activeOrg.id,
        successUrl: `${window.location.origin}/settings?checkout=success`,
        cancelUrl: `${window.location.origin}/settings`,
      });
    } catch {
      setCheckoutLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 mx-4 w-full max-w-2xl rounded-2xl border border-zinc-800/60 bg-zinc-900/95 p-6 shadow-2xl shadow-black/40">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold tracking-tight">Upgrade your plan</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div
              key={plan.slug}
              className={`relative flex flex-col rounded-xl border p-5 ${
                plan.popular
                  ? "border-green-500/40 bg-green-500/5"
                  : "border-zinc-800 bg-zinc-950/50"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
                  Popular
                </span>
              )}
              <div className="mb-4">
                <p className="text-lg font-semibold">{plan.name}</p>
                <p className="mt-1">
                  <span className="text-2xl font-bold">{plan.price}</span>
                  <span className="text-sm text-zinc-400">{plan.period}</span>
                </p>
                <p className="mt-1 text-xs text-zinc-500">{plan.note}</p>
              </div>
              <ul className="mb-6 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-zinc-300">
                    <svg className="h-4 w-4 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleCheckout(plan.slug)}
                disabled={checkoutLoading !== null}
                className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 ${
                  plan.popular
                    ? "bg-white text-black hover:bg-zinc-200"
                    : "border border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                {checkoutLoading === plan.slug ? "Redirecting..." : "Subscribe"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
