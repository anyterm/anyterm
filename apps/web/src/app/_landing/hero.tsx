import Link from "next/link";
import { LockIcon, GithubIcon } from "./icons";

export function Hero() {
  return (
    <section className="hero-glow relative z-10 overflow-hidden px-6 pt-24 pb-16 md:pt-36 md:pb-24">
      <div className="mx-auto max-w-4xl text-center">
        <div className="animate-fade-in-up inline-flex items-center gap-2 rounded-full border border-zinc-800/60 bg-zinc-900/40 px-4 py-1.5 text-xs text-zinc-400">
          <LockIcon className="h-3 w-3 text-green-400" />
          <span>End-to-end encrypted</span>
          <span className="text-zinc-700">&middot;</span>
          <span>Source-available</span>
        </div>

        <h1 className="animate-fade-in-up stagger-1 mt-8 font-display text-[clamp(2.25rem,6vw,4.5rem)] font-extrabold leading-[1.1] tracking-tight">
          Your terminal.{" "}
          <span className="animate-gradient bg-gradient-to-r from-green-400 via-emerald-300 to-teal-400 bg-clip-text text-transparent">
            Everywhere.
          </span>
        </h1>

        <p className="animate-fade-in-up stagger-2 mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-400 md:text-xl">
          One command to start streaming. Open the link on any device.{" "}
          <span className="text-zinc-300">The server never sees your data.</span>
        </p>

        <div className="animate-fade-in-up stagger-3 mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
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
            View Source
          </a>
        </div>
      </div>

      {/* hero terminal */}
      <div className="mx-auto mt-16 max-w-3xl md:mt-20">
        <div className="animate-fade-in-up stagger-4 terminal-breathe float overflow-hidden rounded-2xl border border-zinc-800/60 bg-[#0c0c0e]">
          {/* title bar */}
          <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <div className="h-3 w-3 rounded-full bg-[#28c840]" />
            </div>
            <span className="font-code text-xs text-zinc-600">~/projects</span>
            <div className="flex items-center gap-2">
              <span className="animate-pulse-dot inline-block h-2 w-2 rounded-full bg-green-500" />
              <span className="font-code text-xs font-bold text-green-400">LIVE</span>
            </div>
          </div>

          {/* terminal content */}
          <div className="p-6 font-code text-sm leading-7 md:p-8">
            <div>
              <span className="text-emerald-400">$</span>{" "}
              <span className="text-zinc-300">anyterm run</span>{" "}
              <span className="text-amber-300">claude</span>
            </div>
            <div className="mt-3 flex flex-col gap-1 text-zinc-500">
              <span>
                {"  "}Session: <span className="text-zinc-300">a3f9k</span>
              </span>
              <span>
                {"  "}Web:{"     "}
                <span className="text-teal-400 underline decoration-teal-400/30">
                  https://anyterm.dev/s/a3f9k
                </span>
              </span>
              <span className="flex items-center gap-2">
                {"  "}
                <LockIcon className="inline h-3.5 w-3.5 text-green-500" />
                <span className="text-green-400">Streaming encrypted</span>
              </span>
            </div>

            <div className="mt-6 border-t border-zinc-800/40 pt-5">
              <div className="text-zinc-500">
                {"  "}<span className="text-violet-400">claude</span>{" "}
                <span className="text-zinc-600">&gt;</span>{" "}
                <span className="text-zinc-400">I&apos;ll implement the auth flow. Reading existing code...</span>
              </div>
              <div className="mt-2 text-zinc-600">
                {"  "}<span className="text-green-400">&#10003;</span>{" "}
                <span className="text-zinc-400">Updated</span>{" "}
                <span className="text-zinc-300">src/lib/auth.ts</span>
              </div>
              <div className="text-zinc-600">
                {"  "}<span className="text-green-400">&#10003;</span>{" "}
                <span className="text-zinc-400">Added rate limiting to</span>{" "}
                <span className="text-zinc-300">3 API routes</span>
              </div>
              <div className="text-zinc-600">
                {"  "}<span className="text-green-400">&#10003;</span>{" "}
                <span className="text-zinc-400">Generated test suite</span>{" "}
                <span className="text-zinc-500">(14 tests)</span>
              </div>
              <div className="mt-2 text-zinc-600">
                {"  "}Running tests...
                <span className="animate-blink ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-emerald-400" />
              </div>
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-sm text-zinc-600">
          Open that URL on your phone, tablet, or any browser. Type in it — keystrokes hit the real PTY.
        </p>
      </div>
    </section>
  );
}
