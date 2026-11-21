"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/site/header";
import { Tag, Spinner } from "@/components/brut/kit";
import { session, homeFor, type Role } from "@/lib/api";
import { useSession } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const NAV: Record<Role, { href: string; label: string }[]> = {
  citizen: [
    { href: "/app/citizen", label: "My help" },
    { href: "/app/citizen/check", label: "Check a message" },
    { href: "/app/citizen/consent", label: "Who can see my data" },
  ],
  helper: [{ href: "/app/helper", label: "Families" }],
  officer: [
    { href: "/app/officer", label: "Queue" },
    { href: "/app/officer/inbox", label: "Complaints & changes" },
    { href: "/app/officer/signals", label: "Scams & anomalies" },
  ],
  admin: [
    { href: "/app/admin", label: "Break it" },
    { href: "/app/admin/chaos", label: "Chaos panel" },
    { href: "/app/admin/rules", label: "Rules & threshold" },
    { href: "/app/officer", label: "Queue" },
  ],
  auditor: [
    { href: "/app/auditor", label: "Audit log" },
    { href: "/app/auditor/ai", label: "AI decisions" },
  ],
};

const ROLE_LABEL: Record<Role, string> = { citizen: "Citizen", helper: "Helper", officer: "Officer", admin: "Admin", auditor: "Auditor" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const s = useSession();
  const router = useRouter();
  const path = usePathname();

  React.useEffect(() => {
    if (s === null) router.replace("/login");
    else if (s && path === "/app") router.replace(homeFor(s.user.role));
  }, [s, router, path]);

  if (!s) return <div className="container-page"><Spinner label="Checking your sign-in" /></div>;
  const role = s.user.role;
  const nav = NAV[role];

  return (
    <div className="min-h-dvh">
      <header className="container-page flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="flex items-center gap-4">
          <Logo />
          <Tag tone="dark">Prototype</Tag>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-right sm:block">
            <span className="block font-medium leading-tight">{s.user.displayName}</span>
            <span className="text-[13px] text-muted-ink">{ROLE_LABEL[role]}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              session.set(null);
              session.setFamily(null);
              router.push("/login");
            }}
            className="inline-flex items-center gap-2 rounded-[14px] border border-ink px-4 py-2.5 transition-colors hover:bg-ink hover:text-white"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      </header>
      {nav.length > 1 && (
        <nav aria-label="Sections" className="container-page">
          <ul className="flex gap-2 overflow-x-auto rounded-[18px] border border-ink bg-mist p-1.5 [scrollbar-width:none]">
            {nav.map((n) => {
              const active = path === n.href;
              return (
                <li key={n.href} className="relative shrink-0">
                  {active && <motion.span layoutId="app-nav-pill" className="absolute inset-0 rounded-[13px] border border-ink bg-white shadow-hard" transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }} />}
                  <Link href={n.href} aria-current={active ? "page" : undefined} className={cn("relative block whitespace-nowrap rounded-[13px] px-4 py-2.5 text-[15px]", active ? "font-medium" : "text-ink/75 hover:text-ink")}>
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <main className="container-page pb-24 pt-8">{children}</main>
    </div>
  );
}
