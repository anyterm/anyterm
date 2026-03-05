import Link from "next/link";
import { AnytermLogo } from "@/components/anyterm-logo";
import { NavAuthButtons } from "@/components/nav-auth-buttons";

export function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" aria-label="Anyterm home">
          <AnytermLogo />
        </Link>
        <div className="hidden items-center gap-8 text-sm md:flex">
          <a href="#features" className="text-zinc-400 transition hover:text-white">Features</a>
          <a href="#pricing" className="text-zinc-400 transition hover:text-white">Pricing</a>
          <a href="https://github.com/anyterm/anyterm" className="text-zinc-400 transition hover:text-white">Source</a>
          <NavAuthButtons />
        </div>
        {/* mobile menu trigger */}
        <div className="flex items-center gap-4 md:hidden">
          <NavAuthButtons />
        </div>
      </div>
    </nav>
  );
}
