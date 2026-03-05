export function QuickStart() {
  return (
    <section className="relative z-10 px-6 py-24 md:py-32">
      <div className="gradient-divider mx-auto mb-24 max-w-4xl md:mb-32" />
      <div className="scroll-reveal mx-auto max-w-2xl text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-green-500">Get started</p>
        <h2 className="mt-3 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-tight">
          Up and running in 60 seconds
        </h2>
      </div>

      <div className="scroll-reveal mx-auto mt-12 max-w-2xl">
        <div className="overflow-hidden rounded-2xl border border-zinc-800/60 bg-[#0c0c0e]">
          <div className="flex items-center gap-2 border-b border-zinc-800/60 px-5 py-3">
            <div className="h-2.5 w-2.5 rounded-full bg-zinc-700/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-zinc-700/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-zinc-700/80" />
          </div>
          <div className="p-6 font-code text-sm leading-8 md:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-500">1</span>
              <span className="text-zinc-600">Install</span>
            </div>
            <div className="ml-8">
              <span className="text-emerald-400">$</span>{" "}
              <span className="text-zinc-300">npm i -g anyterm</span>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-500">2</span>
              <span className="text-zinc-600">Authenticate</span>
            </div>
            <div className="ml-8">
              <span className="text-emerald-400">$</span>{" "}
              <span className="text-zinc-300">anyterm login</span>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20 text-[10px] font-bold text-green-400">3</span>
              <span className="text-zinc-400">Stream any command</span>
            </div>
            <div className="ml-8">
              <span className="text-emerald-400">$</span>{" "}
              <span className="text-zinc-300">anyterm run</span>{" "}
              <span className="text-amber-300">&quot;npm run dev&quot;</span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-zinc-500">
          <span>No SSH</span>
          <span className="text-zinc-800">&middot;</span>
          <span>No VPN</span>
          <span className="text-zinc-800">&middot;</span>
          <span>No port forwarding</span>
          <span className="text-zinc-800">&middot;</span>
          <span>Outbound only</span>
        </div>
      </div>
    </section>
  );
}
