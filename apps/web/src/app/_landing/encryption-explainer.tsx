export function EncryptionExplainer() {
  return (
    <section className="relative z-10 px-6 py-24 md:py-32">
      <div className="gradient-divider mx-auto mb-24 max-w-4xl md:mb-32" />
      <div className="mx-auto max-w-4xl">
        <div className="scroll-reveal text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-green-500">Zero knowledge</p>
          <h2 className="mt-3 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-tight">
            What you see vs. what the server stores
          </h2>
        </div>

        <div className="scroll-reveal mt-12 grid gap-4 md:grid-cols-2">
          {/* your browser */}
          <div className="overflow-hidden rounded-2xl border border-emerald-500/20 bg-[#0c0c0e]">
            <div className="flex items-center gap-2 border-b border-zinc-800/60 px-5 py-3">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="font-code text-xs font-bold text-emerald-400">Your browser</span>
            </div>
            <div className="p-5 font-code text-xs leading-6 md:p-6">
              <div>
                <span className="text-emerald-400">$</span>{" "}
                <span className="text-zinc-300">npm test</span>
              </div>
              <div className="mt-2">
                <span className="text-green-400">PASS</span>{" "}
                <span className="text-zinc-400">src/auth.test.ts</span>
              </div>
              <div>
                <span className="text-green-400">PASS</span>{" "}
                <span className="text-zinc-400">src/api.test.ts</span>
              </div>
              <div>
                <span className="text-red-400">FAIL</span>{" "}
                <span className="text-zinc-400">src/ws.test.ts</span>
              </div>
              <div className="mt-2 ml-2 text-zinc-500">
                Tests: <span className="text-green-400">14 passed</span>, <span className="text-red-400">1 failed</span>
              </div>
            </div>
          </div>

          {/* server database */}
          <div className="overflow-hidden rounded-2xl border border-zinc-800/60 bg-[#0c0c0e]">
            <div className="flex items-center gap-2 border-b border-zinc-800/60 px-5 py-3">
              <div className="h-2 w-2 rounded-full bg-zinc-700" />
              <span className="font-code text-xs text-zinc-600">Server database</span>
            </div>
            <div className="select-none p-5 font-code text-xs leading-6 md:p-6">
              <div className="break-all text-zinc-700">
                x8Kj2mNpQ4vR7wYs1bTfUh3LcDgA9eXo
                ZiWkMnBrJtHlSxCvFqPd6aEuGyO0jI5m
                R3nKfVb8wTcZs1LhMpDxQj7YgAeUo4Wr
                2iJtBkGlXmSvHd6aCnEqFyP9rOuI0wZs
                Q5bMjKf3VhNxTcLg7DpWeYoA1Si8RkUt
                4mHdXnBrJvGlZsCqFaPy6eOuI0wKj2bT
              </div>
            </div>
          </div>
        </div>

        {/* key flow */}
        <div className="scroll-reveal mx-auto mt-10 max-w-3xl">
          <div className="flex flex-wrap items-center justify-center gap-3 font-code text-xs">
            <span className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5 text-zinc-400">
              Password
            </span>
            <span className="text-zinc-700">&rarr;</span>
            <span className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5 text-zinc-400">
              Argon2id
            </span>
            <span className="text-zinc-700">&rarr;</span>
            <span className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5 text-zinc-400">
              masterKey
            </span>
            <span className="text-zinc-700">&rarr;</span>
            <span className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5 text-zinc-400">
              X25519
            </span>
            <span className="text-zinc-700">&rarr;</span>
            <span className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-1.5 text-green-400">
              XChaCha20-Poly1305
            </span>
          </div>
          <p className="mt-6 text-center text-sm text-zinc-600">
            The server is a zero-knowledge relay. It routes ciphertext.{" "}
            <a
              href="https://github.com/anyterm/anyterm"
              className="underline decoration-zinc-700 underline-offset-2 transition hover:text-white"
            >
              Audit every line.
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
