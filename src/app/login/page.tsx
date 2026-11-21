"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { SiteHeader } from "@/components/site/header";
import { Btn, Tag, UrduText } from "@/components/brut/kit";
import { api, ApiError, homeFor, session, type Session, type SessionUser } from "@/lib/api";
import { cn } from "@/lib/utils";

const PEOPLE = [
  { key: "citizen", email: "fatima@asli.demo", name: "Fatima Bibi", ur: "فاطمہ بی بی", role: "Citizen", blurb: "Widow in Lahore. Can't read forms — hears her decision in Urdu and confirms her payment by voice.", tone: "lime" },
  { key: "helper", email: "helper@asli.demo", name: "Rukhsana", ur: "رخسانہ", role: "Community helper", blurb: "One phone, six families. Switches between them with each family's own PIN.", tone: "white" },
  { key: "shopkeeper", email: "shopkeeper@asli.demo", name: "Imran", ur: "عمران", role: "Shopkeeper", blurb: "Customers show him “relief” SMS all day. He checks them before handing out cash.", tone: "white" },
  { key: "officer", email: "officer@asli.demo", name: "Officer Bilal", ur: "افسر بلال", role: "Case officer", blurb: "Works the queue: sees why the AI was unsure and releases money — the AI never can.", tone: "dark" },
  { key: "officer2", email: "officer2@asli.demo", name: "Officer Hina", ur: "افسر حنا", role: "Second approver", blurb: "Gives the second approval on payouts above Rs 10,000.", tone: "dark" },
  { key: "admin", email: "admin@asli.demo", name: "Sana", ur: "ثنا", role: "Programme admin", blurb: "Edits the rules, breaks the mock registries on purpose, and runs the attack suite.", tone: "mist" },
  { key: "auditor", email: "auditor@asli.demo", name: "Kamran", ur: "کامران", role: "Auditor", blurb: "Read-only. Verifies the tamper-evident log and replays any AI decision.", tone: "mist" },
] as const;

const TONE = { lime: "bg-lime", white: "bg-white", dark: "bg-ink text-white on-dark", mist: "bg-mist" } as const;

type DemoTokens = { tokens: Record<string, { role: string; token: string; expiresAt: string }> };

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const highlight = params.get("as");
  const [demo, setDemo] = React.useState<DemoTokens["tokens"] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    api<DemoTokens>("/demo/tokens", { anonymous: true }).then(
      (r) => setDemo(r.tokens),
      () => setDemo({}),
    );
  }, []);

  async function finish(token: string, expiresAt: string, user?: SessionUser) {
    let u = user;
    if (!u) {
      session.set({ token, expiresAt, user: { id: "", email: "", role: "citizen", displayName: "", tenantId: "", citizenId: null, canSecondApprove: false } });
      u = (await api<{ user: SessionUser }>("/auth/me")).user;
    }
    session.set({ token, expiresAt, user: u });
    session.setFamily(null);
    router.push(homeFor(u.role));
  }

  async function oneTap(email: string) {
    setErr(null);
    const t = demo?.[email];
    if (!t) {
      setEmail(email);
      document.getElementById("pw")?.focus();
      setErr("One-tap sign-in is off on this server. Enter the demo password from the README.");
      return;
    }
    setBusy(email);
    try {
      await finish(t.token, t.expiresAt);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Sign-in failed");
      setBusy(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy("form");
    try {
      const r = await api<Session>("/auth/login", { body: { email, password }, anonymous: true });
      await finish(r.token, r.expiresAt, r.user);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Sign-in failed");
      setBusy(null);
    }
  }

  return (
    <main className="container-page pb-24">
      <div className="flex flex-col gap-4 pt-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-h1">
            Pick who <span className="marker">you are today.</span>
          </h1>
          <p className="mt-4 max-w-[38rem] text-lead">Every person here is fictional and every registry is simulated. Nothing you do reaches a real bank or a real government system.</p>
        </div>
        <Tag tone="dark" className="self-start md:self-auto">Prototype</Tag>
      </div>

      <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {PEOPLE.map((p, i) => (
          <motion.li key={p.email} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", bounce: 0, visualDuration: 0.4, delay: i * 0.04 }}>
            <button
              type="button"
              onClick={() => oneTap(p.email)}
              disabled={!!busy}
              className={cn(
                "group flex h-full w-full flex-col gap-4 rounded-[28px] border border-ink p-6 text-left shadow-hard transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-hard-lg disabled:opacity-60",
                TONE[p.tone],
                highlight && (highlight === p.key ? "ring-4 ring-lime ring-offset-2 ring-offset-white" : ""),
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-medium">{p.name}</div>
                  <div lang="ur" className="urdu text-base opacity-80">
                    {p.ur}
                  </div>
                </div>
                <span className={cn("rounded-[7px] border px-2 py-0.5 font-mono text-[12px] uppercase", p.tone === "dark" ? "border-white bg-white text-ink" : "border-ink bg-white")}>{p.role}</span>
              </div>
              <p className={cn("text-[15px]", p.tone === "dark" ? "text-white/85" : "text-ink/80")}>{p.blurb}</p>
              <span className="mt-auto font-medium underline decoration-2 underline-offset-4">{busy === p.email ? "Signing in…" : demo && demo[p.email] ? "Continue as " + p.name.split(" ")[0] : "Use this account"}</span>
            </button>
          </motion.li>
        ))}
      </ul>

      <form onSubmit={submit} className="mt-12 grid max-w-3xl gap-4 rounded-[28px] border border-ink bg-mist p-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:p-8">
        <div className="sm:col-span-3">
          <h2 className="text-lg font-medium">Or sign in with email</h2>
          <UrduText className="text-base text-muted-ink">ای میل اور پاس ورڈ سے داخل ہوں</UrduText>
        </div>
        <label className="space-y-2">
          <span className="text-[15px]">Email</span>
          <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="space-y-2">
          <span className="text-[15px]">Password</span>
          <input id="pw" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <Btn type="submit" loading={busy === "form"}>
          Sign in
        </Btn>
      </form>
      {err && (
        <p role="alert" className="mt-4 max-w-3xl rounded-[14px] border border-ink bg-white px-4 py-3">
          {err}
        </p>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <>
      <SiteHeader />
      <React.Suspense>
        <LoginInner />
      </React.Suspense>
    </>
  );
}
