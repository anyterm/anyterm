import { ShieldIcon } from "./icons";

export function TrustStrip() {
  return (
    <>
      <div className="gradient-divider" />
      <section className="relative z-10 px-6 py-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-zinc-600">
          <span className="flex items-center gap-2">
            <ShieldIcon className="h-3.5 w-3.5" />
            Zero-knowledge relay
          </span>
          <span className="text-zinc-800">&middot;</span>
          <span>Works with any command</span>
          <span className="text-zinc-800">&middot;</span>
          <span>macOS &amp; Linux</span>
          <span className="text-zinc-800">&middot;</span>
          <span>Source-available</span>
        </div>
      </section>
      <div className="gradient-divider" />
    </>
  );
}
