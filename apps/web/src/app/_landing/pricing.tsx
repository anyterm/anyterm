import Link from "next/link";
import { CheckIcon } from "./icons";

export function Pricing() {
  return (
    <section id="pricing" className="relative z-10 px-6 py-24 md:py-32">
      <div className="gradient-divider mx-auto mb-24 max-w-4xl md:mb-32" />
      <div className="mx-auto max-w-5xl">
        <div className="scroll-reveal text-center">
          <h2 className="font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-tight">
            Pricing
          </h2>
          <p className="mt-3 text-sm text-zinc-500">
            Self-host for free. Or let us handle the infrastructure.
          </p>
        </div>

        <div className="scroll-reveal mt-12 grid gap-4 md:grid-cols-3">
          <PricingCard
            name="Self-Hosted"
            price="Free"
            period="forever"
            desc="Source-available. Your infrastructure."
            features={[
              "No session cap",
              "Unlimited storage",
              "Full source code",
              "Community support",
            ]}
            cta="View on GitHub"
            href="https://github.com/anyterm/anyterm"
            variant="default"
          />
          <PricingCard
            name="Cloud Pro"
            price="$12"
            period="/user/mo"
            desc="14-day free trial. No credit card."
            features={[
              "3 concurrent sessions",
              "7-day retention",
              "50 GB storage",
              "$10/user/mo billed annually",
            ]}
            cta="Start Free Trial"
            href="/register"
            variant="featured"
            badge="Most Popular"
          />
          <PricingCard
            name="Cloud Team"
            price="$29"
            period="/user/mo"
            desc="5-seat minimum. For organizations."
            features={[
              "10 sessions/user, 100/org",
              "30-day retention",
              "SSO, RBAC & audit logs",
              "$24/user/mo billed annually",
            ]}
            cta="Start Free Trial"
            href="/register"
            variant="default"
          />
        </div>
      </div>
    </section>
  );
}

function PricingCard({
  name, price, period, desc, features, cta, href, variant = "default", badge,
}: {
  name: string; price: string; period: string; desc: string;
  features: string[]; cta: string; href: string;
  variant?: "default" | "featured"; badge?: string;
}) {
  const isFeatured = variant === "featured";
  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 transition-all duration-300 ${
        isFeatured
          ? "pricing-glow border-green-500/30 bg-zinc-900/60"
          : "border-zinc-800/60 bg-zinc-900/30 hover:border-zinc-700/60"
      }`}
    >
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-green-500 px-3 py-0.5 text-xs font-bold text-zinc-950">
          {badge}
        </div>
      )}
      <h3 className="font-display text-base font-bold">{name}</h3>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="font-display text-3xl font-extrabold">{price}</span>
        <span className="text-sm text-zinc-500">{period}</span>
      </div>
      <p className="mt-2 text-sm text-zinc-500">{desc}</p>
      <ul className="mt-6 flex-1 space-y-3">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <CheckIcon
              className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                isFeatured ? "text-green-400" : "text-zinc-600"
              }`}
            />
            <span className="text-zinc-300">{f}</span>
          </li>
        ))}
      </ul>
      <Link
        href={href}
        className={`mt-6 block rounded-xl px-4 py-3 text-center text-sm font-bold transition ${
          isFeatured
            ? "bg-green-500 text-zinc-950 hover:bg-green-400"
            : "border border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/50"
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}
