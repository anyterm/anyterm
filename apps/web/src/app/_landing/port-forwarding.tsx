export function PortForwarding() {
  return (
    <section className="relative z-10 px-6 py-24 md:py-32">
      <div className="gradient-divider mx-auto mb-24 max-w-4xl md:mb-32" />
      <div className="scroll-reveal mx-auto max-w-4xl">
        <p className="text-xs font-bold uppercase tracking-widest text-green-500">Not just a terminal</p>
        <h2 className="mt-3 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-tight">
          Preview what&apos;s running. From anywhere.
        </h2>
        <p className="mt-3 max-w-xl text-[15px] text-zinc-500">
          Forward local ports through the encrypted tunnel. Your AI agent spins up a dev server —
          you see the result in a tab right next to the terminal.
        </p>

        <div className="mt-10 overflow-hidden rounded-2xl border border-zinc-800/60 bg-[#0c0c0e]">
          {/* tab bar */}
          <div className="flex items-center gap-0 border-b border-zinc-800/60 bg-zinc-900/40">
            <div className="flex items-center gap-2 border-r border-zinc-800/60 px-4 py-2.5">
              <span className="animate-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
              <span className="font-code text-xs text-white">Terminal</span>
            </div>
            <div className="flex items-center gap-2 border-r border-zinc-800/60 bg-zinc-800/30 px-4 py-2.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal-400" />
              <span className="font-code text-xs text-zinc-400">:3000 Preview</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-600" />
              <span className="font-code text-xs text-zinc-600">:5173 Docs</span>
            </div>
          </div>

          <div className="grid md:grid-cols-2">
            {/* terminal pane */}
            <div className="border-b border-zinc-800/60 p-5 font-code text-xs leading-6 md:border-b-0 md:border-r">
              <div>
                <span className="text-emerald-400">$</span>{" "}
                <span className="text-zinc-300">anyterm run</span>{" "}
                <span className="text-amber-300">&quot;npm run dev&quot;</span>{" "}
                <span className="text-zinc-500">--forward 3000,5173</span>
              </div>
              <div className="mt-2 text-zinc-600">
                Forwarding <span className="text-teal-400">:3000</span>{" "}
                <span className="text-zinc-700">&rarr;</span>{" "}
                <span className="text-zinc-500">anyterm.dev/port/3000</span>
              </div>
              <div className="text-zinc-600">
                Forwarding <span className="text-teal-400">:5173</span>{" "}
                <span className="text-zinc-700">&rarr;</span>{" "}
                <span className="text-zinc-500">anyterm.dev/port/5173</span>
              </div>
              <div className="mt-3 border-t border-zinc-800/40 pt-3 text-zinc-600">
                <span className="text-green-400">&#10003;</span> compiled in 230ms
              </div>
              <div className="text-zinc-600">
                <span className="text-violet-400">agent</span>{" "}
                <span className="text-zinc-700">&gt;</span>{" "}
                <span className="text-zinc-400">Updated navbar component</span>
                <span className="animate-blink ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-emerald-400" />
              </div>
            </div>

            {/* web preview pane */}
            <div className="p-5">
              <div className="overflow-hidden rounded-lg border border-zinc-800/60 bg-zinc-950">
                <div className="flex items-center gap-1.5 border-b border-zinc-800/60 px-3 py-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                  <div className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                  <div className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                  <span className="ml-2 font-code text-[10px] text-zinc-600">localhost:3000</span>
                </div>
                <div className="px-4 py-5">
                  <div className="h-2.5 w-20 rounded bg-zinc-800" />
                  <div className="mt-4 flex gap-3">
                    <div className="h-14 flex-1 rounded-lg bg-zinc-800/60" />
                    <div className="h-14 flex-1 rounded-lg bg-zinc-800/60" />
                    <div className="h-14 flex-1 rounded-lg bg-zinc-800/60" />
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <div className="h-2 w-full rounded bg-zinc-800/40" />
                    <div className="h-2 w-3/4 rounded bg-zinc-800/40" />
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center font-code text-[10px] text-zinc-600">
                Live preview of your forwarded port
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
