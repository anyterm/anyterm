export function PhoneScene() {
  return (
    <section className="relative z-10 px-6 py-24 md:py-32">
      <div className="scroll-reveal mx-auto max-w-4xl">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-600">
              20 minutes later. On the train.
            </p>
            <h2 className="mt-4 font-display text-2xl font-bold tracking-tight md:text-3xl">
              The build failed.
              <br />
              <span className="text-zinc-400">Fix it from your phone.</span>
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-zinc-500">
              A test broke. You see it live, fix the code, restart the process.
              All from your phone. Every keystroke is encrypted end-to-end and
              hits the real PTY on your Mac.
            </p>
          </div>

          {/* phone mockup */}
          <div className="mx-auto max-w-[240px] md:mx-0 md:ml-auto">
            <div className="rounded-[2rem] border-2 border-zinc-700/60 bg-zinc-900/40 p-2 shadow-2xl shadow-black/40">
              <div className="overflow-hidden rounded-[1.5rem] bg-[#0c0c0e]">
                <div className="flex items-center justify-between px-5 pt-3 pb-1">
                  <span className="font-code text-[10px] text-zinc-600">9:41</span>
                  <div className="flex items-center gap-2">
                    <span className="animate-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                    <span className="font-code text-[10px] font-bold text-green-400">LIVE</span>
                  </div>
                </div>

                <div className="p-4 font-code text-[11px] leading-5">
                  <div className="text-red-400">
                    FAIL <span className="text-zinc-400">src/auth.test.ts</span>
                  </div>
                  <div className="mt-1 text-zinc-600">
                    expected <span className="text-green-400">200</span> received <span className="text-red-400">401</span>
                  </div>
                  <div className="mt-3">
                    <span className="text-emerald-400">$</span>{" "}
                    <span className="text-zinc-300">vim src/lib/auth.ts</span>
                    <span className="animate-blink ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-emerald-400" />
                  </div>
                </div>

                <div className="border-t border-zinc-800/60 bg-zinc-900/80 px-3 py-2">
                  <div className="flex gap-1">
                    {["Esc", "Tab", "Ctrl", "\u2191", "\u2193", "\u2190", "\u2192"].map((k) => (
                      <span
                        key={k}
                        className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-code text-[9px] text-zinc-500"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
