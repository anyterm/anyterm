import Link from "next/link";
import { GithubIcon } from "./icons";

export function FinalCta() {
  return (
    <section className="relative z-10 px-6 py-24 md:py-32">
      <div className="gradient-divider mx-auto mb-24 max-w-4xl md:mb-32" />
      <div className="scroll-reveal mx-auto max-w-2xl text-center">
        <h2 className="font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-tight">
          Next time you start a long-running task,{" "}
          <span className="bg-gradient-to-r from-green-400 via-emerald-300 to-teal-400 bg-clip-text text-transparent">
            start it with anyterm.
          </span>
        </h2>

        <div className="mt-8 overflow-hidden rounded-xl border border-zinc-800/60 bg-[#0c0c0e] px-6 py-4">
          <code className="font-code text-sm md:text-base">
            <span className="text-zinc-500">npm i -g anyterm &&</span>{" "}
            <span className="text-emerald-400">anyterm run</span>{" "}
            <span className="text-amber-300">&quot;your command&quot;</span>
          </code>
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/register"
            className="inline-flex items-center gap-2.5 rounded-xl bg-white px-8 py-3.5 font-display text-sm font-bold text-zinc-950 shadow-lg shadow-white/5 transition hover:bg-zinc-200"
          >
            Get Started Free
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
          <a
            href="https://github.com/anyterm/anyterm"
            className="inline-flex items-center gap-2.5 rounded-xl border border-zinc-800 px-8 py-3.5 font-display text-sm font-bold text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-900/60"
          >
            <GithubIcon className="h-4 w-4" />
            Self-Host
          </a>
        </div>

        <p className="mt-6 text-xs text-zinc-600">
          Source-available under{" "}
          <a
            href="https://polyformproject.org/licenses/shield/1.0.0/"
            className="underline decoration-zinc-700 underline-offset-2 transition hover:text-white"
          >
            PolyForm Shield
          </a>{" "}
          license. Audit every line.
        </p>
      </div>
    </section>
  );
}
