"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { BtnLink } from "@/components/brut/kit";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/check", label: "Check a message" },
  { href: "/phone", label: "By phone" },
  { href: "/#safety", label: "Safety" },
  { href: "/transparency", label: "Numbers" },
];

export function Logo({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5", className)} aria-label="Asli home">
      <svg viewBox="0 0 36 36" className="size-9" aria-hidden>
        <path d="M18 2 C20 12 24 16 34 18 C24 20 20 24 18 34 C16 24 12 20 2 18 C12 16 16 12 18 2Z" fill={tone === "dark" ? "#191A23" : "#fff"} />
        <circle cx="18" cy="18" r="5" fill="#B9FF66" stroke="#191A23" strokeWidth="1.5" />
      </svg>
      <span className={cn("text-[1.65rem] font-semibold tracking-tight", tone === "light" && "text-white")}>Asli</span>
      <span lang="ur" className={cn("urdu text-lg leading-none", tone === "light" ? "text-white/70" : "text-muted-ink")}>
        اصلی
      </span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="container-page flex items-center justify-between gap-6 py-6 sm:py-8">
      <Logo />
      <nav aria-label="Main" className="hidden items-center gap-10 lg:flex">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="text-[1.05rem] text-ink underline-offset-[6px] hover:underline decoration-lime decoration-[3px]">
            {n.label}
          </Link>
        ))}
        <BtnLink href="/login" variant="secondary">
          Sign in to the demo
        </BtnLink>
      </nav>
      <Sheet>
        <SheetTrigger className="lg:hidden grid size-12 place-items-center rounded-[14px] border border-ink bg-white shadow-hard" aria-label="Open menu">
          <Menu className="size-6" />
        </SheetTrigger>
        <SheetContent side="right" showCloseButton={false} className="w-[86%] max-w-sm border-l border-ink bg-white p-6">
          <div className="flex items-center justify-between">
            <SheetTitle>
              <Logo />
            </SheetTitle>
            <SheetClose className="grid size-11 place-items-center rounded-[14px] border border-ink" aria-label="Close menu">
              <X className="size-5" />
            </SheetClose>
          </div>
          <nav aria-label="Main" className="mt-8 flex flex-col gap-2">
            {NAV.map((n) => (
              <SheetClose key={n.href} render={<Link href={n.href} />} className="rounded-[14px] border border-transparent px-4 py-3 text-lg hover:border-ink hover:bg-mist">
                {n.label}
              </SheetClose>
            ))}
          </nav>
          <BtnLink href="/login" className="mt-auto w-full">
            Sign in to the demo
          </BtnLink>
        </SheetContent>
      </Sheet>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="container-page pb-0">
      <div className="on-dark rounded-t-[45px] bg-ink px-8 pb-10 pt-12 text-white sm:px-14">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <Logo tone="light" />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-white/90">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="underline-offset-4 hover:underline">
                {n.label}
              </Link>
            ))}
            <a href="/api/docs" className="underline-offset-4 hover:underline">
              API docs
            </a>
          </nav>
        </div>
        <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-2">
            <p>
              <span className="marker">Prototype</span>
            </p>
            <p className="max-w-md text-white/80">
              Asli is a Coder&rsquo;s Cup 2026 prototype, not an official government service. Every identity, payment and registry here is simulated, and every person in the demo is fictional.
            </p>
          </div>
          <div className="rounded-[14px] bg-white/5 p-6">
            <p className="font-medium">Got a message about relief money?</p>
            <p className="mt-1 text-white/80">Never pay a fee or share a code to receive help. Check the message first.</p>
            <Link href="/check" className="mt-4 inline-flex rounded-[14px] bg-lime px-6 py-3 font-medium text-black transition-colors hover:bg-white">
              Check a message
            </Link>
          </div>
        </div>
        <div className="mt-12 border-t border-white/30 pt-6 text-[15px] text-white/70">© 2026 Asli team · ACM NUCES Coder&rsquo;s Cup · All data fictional</div>
      </div>
    </footer>
  );
}
