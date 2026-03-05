export function Footer() {
  return (
    <footer className="relative z-10 border-t border-zinc-800/40 px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs text-zinc-600 md:flex-row">
        <span className="font-display font-bold tracking-tight">anyterm</span>
        <div className="flex items-center gap-6">
          <a href="https://github.com/anyterm/anyterm" className="transition hover:text-white">GitHub</a>
          <a href="#features" className="transition hover:text-white">Features</a>
          <a href="#pricing" className="transition hover:text-white">Pricing</a>
          <span>&copy; 2026 anyterm</span>
        </div>
      </div>
    </footer>
  );
}
