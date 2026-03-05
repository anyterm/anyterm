export function DaemonSection() {
  return (
    <section className="relative z-10 px-6 py-24 md:py-32">
      <div className="gradient-divider mx-auto mb-24 max-w-4xl md:mb-32" />
      <div className="scroll-reveal mx-auto max-w-4xl">
        <p className="text-xs font-bold uppercase tracking-widest text-green-500">Daemon mode</p>
        <h2 className="mt-3 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-tight">
          Start sessions on remote machines. From your browser.
        </h2>
        <p className="mt-3 max-w-xl text-[15px] text-zinc-500">
          Install the anyterm daemon on any server or dev box. It shows up in your dashboard.
          Click &quot;New session&quot; — get a full interactive terminal. No SSH keys, no VPN, no firewall rules.
        </p>

        <div className="mt-10 overflow-hidden rounded-2xl border border-zinc-800/60 bg-[#0c0c0e]">
          <div className="border-b border-zinc-800/60 px-5 py-3">
            <span className="font-display text-sm font-bold text-zinc-300">Machines</span>
          </div>
          <div className="divide-y divide-zinc-800/40">
            {[
              { name: "dev-macbook", os: "macOS", status: "online" as const, sessions: 2 },
              { name: "staging-01", os: "Ubuntu 24.04", status: "online" as const, sessions: 1 },
              { name: "gpu-worker", os: "Ubuntu 22.04", status: "offline" as const, sessions: 0 },
            ].map((m) => (
              <div key={m.name} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      m.status === "online" ? "bg-green-500" : "bg-zinc-700"
                    }`}
                  />
                  <div>
                    <span className="font-code text-sm text-zinc-200">{m.name}</span>
                    <span className="ml-2 text-xs text-zinc-600">{m.os}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {m.sessions > 0 && (
                    <span className="font-code text-xs text-zinc-500">
                      {m.sessions} active
                    </span>
                  )}
                  <button
                    className={`rounded-lg px-3 py-1.5 font-code text-xs font-bold transition ${
                      m.status === "online"
                        ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                        : "cursor-not-allowed bg-zinc-900 text-zinc-700"
                    }`}
                    disabled={m.status !== "online"}
                  >
                    New session
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-900/20 px-5 py-4">
          <div className="font-code text-sm leading-7">
            <div><span className="text-zinc-600"># on your remote machine</span></div>
            <div>
              <span className="text-emerald-400">$</span>{" "}
              <span className="text-zinc-300">anyterm daemon --name staging-01</span>
            </div>
            <div className="mt-1 text-zinc-600">
              Registered as <span className="text-zinc-400">staging-01</span>. Waiting for sessions...
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
