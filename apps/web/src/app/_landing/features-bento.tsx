import { LockIcon, KeyboardIcon, LayersIcon, ServerIcon, SmartphoneIcon } from "./icons";

export function FeaturesBento() {
  return (
    <section id="features" className="relative z-10 px-6 py-24 md:py-32">
      <div className="mx-auto max-w-5xl">
        <div className="scroll-reveal text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-green-500">Features</p>
          <h2 className="mt-3 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-tight">
            Everything you need. Nothing you don&apos;t.
          </h2>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {/* E2E Encryption — large card */}
          <div className="bento-card scroll-reveal col-span-full overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-0 md:col-span-2">
            <div className="p-6 pb-0 md:p-8 md:pb-0">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1">
                <LockIcon className="h-3.5 w-3.5 text-green-400" />
                <span className="text-xs font-bold text-green-400">End-to-end encrypted</span>
              </div>
              <h3 className="font-display text-lg font-bold tracking-tight">
                Your password derives the key. The server stores only noise.
              </h3>
              <p className="mt-2 max-w-md text-sm text-zinc-500">
                Argon2id key derivation, X25519 key exchange, XChaCha20-Poly1305 encryption.
                The relay server is zero-knowledge by design.
              </p>
            </div>
            {/* mini side-by-side */}
            <div className="mt-5 grid grid-cols-2 border-t border-zinc-800/40">
              <div className="border-r border-zinc-800/40 px-5 py-4 md:px-6">
                <span className="font-code text-[10px] font-bold text-emerald-400">YOUR BROWSER</span>
                <div className="mt-2 font-code text-xs leading-5 text-zinc-400">
                  <div><span className="text-green-400">PASS</span> auth.test.ts</div>
                  <div><span className="text-green-400">PASS</span> api.test.ts</div>
                  <div><span className="text-red-400">FAIL</span> ws.test.ts</div>
                  <div className="mt-1 text-zinc-500">14 passed, 1 failed</div>
                </div>
              </div>
              <div className="px-5 py-4 md:px-6">
                <span className="font-code text-[10px] font-bold text-zinc-600">SERVER DATABASE</span>
                <div className="mt-2 select-none font-code text-xs leading-5 text-zinc-700">
                  <div>x8Kj2mNpQ4vR7wYs</div>
                  <div>ZiWkMnBrJtHlSxCv</div>
                  <div>R3nKfVb8wTcZs1Lh</div>
                  <div>2iJtBkGlXmSvHd6a</div>
                </div>
              </div>
            </div>
          </div>

          {/* Bidirectional input */}
          <div className="bento-card scroll-reveal overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6">
            <KeyboardIcon className="h-8 w-8 text-zinc-600" />
            <h3 className="mt-4 font-display text-base font-bold">Bidirectional input</h3>
            <p className="mt-2 text-sm text-zinc-500">
              Type in the browser — encrypted keystrokes travel to the real PTY.
              Full interactive shell, not view-only.
            </p>
            <div className="mt-5 overflow-hidden rounded-lg border border-zinc-800/40 bg-[#0c0c0e] px-4 py-3 font-code text-xs">
              <span className="text-emerald-400">$</span>{" "}
              <span className="text-zinc-400">vim src/app.ts</span>
              <span className="animate-blink ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-emerald-400" />
            </div>
          </div>

          {/* Port forwarding */}
          <div className="bento-card scroll-reveal overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6">
            <LayersIcon className="h-8 w-8 text-zinc-600" />
            <h3 className="mt-4 font-display text-base font-bold">Port forwarding</h3>
            <p className="mt-2 text-sm text-zinc-500">
              Preview your dev server in a tab right next to the terminal.
              Forward any local port through the encrypted tunnel.
            </p>
            <div className="mt-5 flex gap-0 overflow-hidden rounded-lg border border-zinc-800/40 text-[10px]">
              <div className="flex items-center gap-1.5 border-r border-zinc-800/40 bg-[#0c0c0e] px-3 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                <span className="font-code text-white">Terminal</span>
              </div>
              <div className="flex items-center gap-1.5 bg-zinc-800/30 px-3 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                <span className="font-code text-zinc-400">:3000</span>
              </div>
            </div>
          </div>

          {/* Daemon mode */}
          <div className="bento-card scroll-reveal overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6">
            <ServerIcon className="h-8 w-8 text-zinc-600" />
            <h3 className="mt-4 font-display text-base font-bold">Daemon mode</h3>
            <p className="mt-2 text-sm text-zinc-500">
              Install the daemon on any server. Start sessions from your browser.
              No SSH keys, no VPN, no firewall rules.
            </p>
            <div className="mt-5 space-y-1.5 font-code text-[11px]">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                <span className="text-zinc-300">dev-macbook</span>
                <span className="ml-auto text-zinc-600">2 active</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                <span className="text-zinc-300">staging-01</span>
                <span className="ml-auto text-zinc-600">1 active</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                <span className="text-zinc-600">gpu-worker</span>
                <span className="ml-auto text-zinc-700">offline</span>
              </div>
            </div>
          </div>

          {/* Mobile ready */}
          <div className="bento-card scroll-reveal overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6">
            <SmartphoneIcon className="h-8 w-8 text-zinc-600" />
            <h3 className="mt-4 font-display text-base font-bold">Mobile ready</h3>
            <p className="mt-2 text-sm text-zinc-500">
              Virtual keyboard with Ctrl, Esc, arrow keys. Pinch-to-zoom.
              Touch-optimized. Works on any phone or tablet.
            </p>
            <div className="mt-5 flex gap-1">
              {["Esc", "Tab", "Ctrl", "\u2191", "\u2193"].map((k) => (
                <span
                  key={k}
                  className="rounded bg-zinc-800/60 px-2 py-1 font-code text-[10px] text-zinc-500"
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
