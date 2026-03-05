import { RotatingWords } from "@/components/rotating-words";

export function ProblemSolution() {
  return (
    <>
      {/* ── the story: problem ── */}
      <section className="relative z-10 px-6 pt-28 pb-8 md:pt-36">
        <div className="scroll-reveal mx-auto max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-600">The problem</p>
          <h2 className="mt-4 text-[clamp(1.5rem,3.5vw,2.5rem)] font-bold leading-snug tracking-tight text-zinc-100">
            <RotatingWords /> is running on your Mac.
            <br />
            You need to leave.
          </h2>

          <p className="mt-8 text-lg text-zinc-400">What do you do?</p>

          <div className="mt-6 space-y-4 text-[15px] leading-relaxed">
            <div className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-xs text-red-400">&#10005;</span>
              <p className="text-zinc-500">
                <span className="text-zinc-300">SSH from your phone?</span>{" "}
                Every iOS SSH app looks like 2008. And you need port forwarding or a VPN first.
              </p>
            </div>
            <div className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-xs text-red-400">&#10005;</span>
              <p className="text-zinc-500">
                <span className="text-zinc-300">Screen share?</span>{" "}
                View-only. Compression artifacts. A third party watches your raw screen.
              </p>
            </div>
            <div className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-xs text-red-400">&#10005;</span>
              <p className="text-zinc-500">
                <span className="text-zinc-300">Leave it running and hope?</span>{" "}
                Come back to a failed build, a hung process, or a prompt that&apos;s been waiting 45 minutes for your input.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── the fix ── */}
      <section className="relative z-10 px-6 pt-16 pb-4">
        <div className="scroll-reveal mx-auto max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-widest text-green-500">Or</p>
          <h2 className="mt-3 text-xl font-bold leading-snug tracking-tight text-zinc-100 md:text-2xl">
            One extra word when you start.{" "}
            <span className="bg-gradient-to-r from-green-400 via-emerald-300 to-teal-400 bg-clip-text text-transparent">
              Access from anywhere after.
            </span>
          </h2>

          <div className="mt-8 overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-900/20 px-6 py-4">
            <code className="font-code text-sm md:text-base">
              <span className="text-emerald-400">$</span>{" "}
              <span className="text-zinc-300">anyterm run</span>{" "}
              <span className="text-amber-300">&quot;npm run dev&quot;</span>
            </code>
          </div>
        </div>
      </section>
    </>
  );
}
