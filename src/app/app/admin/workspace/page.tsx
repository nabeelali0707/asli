"use client";

import * as React from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useApi, useAction, fmtWhen } from "@/lib/hooks";
import { Btn, Panel, Spinner, Tag, SectionHeader } from "@/components/brut/kit";

type Tenant = { id: string; name: string; plan: string; usage: { period: string; apiCalls?: number; [k: string]: unknown }[] };
type User = { id: string; email: string; role: string; displayName: string; canSecondApprove: boolean; active?: boolean };
type Key = { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; revokedAt: string | null; lastUsedAt: string | null };
type Hook = { id: string; url: string; events: string[]; active?: boolean; deliveries?: { status: string; createdAt: string }[]; recent?: { status: string; createdAt: string }[] };

const PLANS = ["free", "standard", "enterprise"] as const;
const ROLES = ["officer", "helper", "auditor", "admin"] as const;

export default function Workspace() {
  const tenant = useApi<Tenant>("/admin/tenant");
  const users = useApi<{ users: User[] }>("/admin/users");
  const keys = useApi<{ keys: Key[]; availableScopes: string[] }>("/admin/api-keys");
  const hooks = useApi<{ webhooks: Hook[]; events: string[] }>("/admin/webhooks");
  const { busy, run } = useAction();
  const [nu, setNu] = React.useState({ email: "", password: "", displayName: "", role: "officer" as (typeof ROLES)[number], second: false });
  const [kn, setKn] = React.useState("");
  const [ks, setKs] = React.useState<string[]>(["cases:read"]);
  const [shown, setShown] = React.useState<string | null>(null);
  const [hu, setHu] = React.useState("");
  const [he, setHe] = React.useState<string[]>(["case.created"]);
  const [hs, setHs] = React.useState<string | null>(null);

  if (!tenant.data) return <Spinner />;
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="space-y-16">
      <div>
        <h1 className="text-h1">
          Department <span className="marker">workspace</span>
        </h1>
        <p className="mt-3 text-lead text-muted-ink">{tenant.data.name}. Everything here is scoped to this department only.</p>
      </div>

      <section className="space-y-5">
        <SectionHeader title="Plan & usage">The plan sets the request rate and monthly API limit.</SectionHeader>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Plan">
          {PLANS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={tenant.data!.plan === p}
              disabled={busy === "plan"}
              onClick={() => run("plan", () => api("/admin/tenant/plan", { body: { plan: p } }), () => { toast.success(`Plan: ${p}`); tenant.reload(); })}
              className={"rounded-full border border-ink px-5 py-2 capitalize transition-colors " + (tenant.data!.plan === p ? "bg-ink text-white" : "bg-white hover:bg-lime")}
            >
              {p}
            </button>
          ))}
        </div>
        {tenant.data.usage.length > 0 && (
          <ul className="flex flex-wrap gap-3 font-mono text-[13px]">
            {tenant.data.usage.map((u) => (
              <li key={u.period} className="rounded-[10px] border border-ink bg-white px-3 py-1.5">
                {u.period}: {String(u.apiCalls ?? Object.values(u).find((v) => typeof v === "number") ?? 0)} calls
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-5">
        <SectionHeader title="Staff">Create officers, helpers and auditors. Turning someone off ends their sessions at once.</SectionHeader>
        <ul className="stagger space-y-2">
          {users.data?.users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-ink bg-white p-4">
              <span>
                <b>{u.displayName}</b> <span className="text-muted-ink">{u.email}</span> <Tag>{u.role}</Tag> {u.canSecondApprove && <Tag tone="lime">second approver</Tag>}
              </span>
              <Btn size="sm" variant="secondary" loading={busy === "u" + u.id} onClick={() => run("u" + u.id, () => api(`/admin/users/${u.id}/active`, { body: { active: u.active === false } }), () => { toast.success(u.active === false ? "Turned on" : "Turned off"); users.reload(); })}>
                {u.active === false ? "Turn on" : "Turn off"}
              </Btn>
            </li>
          ))}
        </ul>
        <form
          className="grid gap-4 rounded-[28px] border border-ink bg-mist p-6 shadow-hard sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("nu", () => api("/admin/users", { body: { email: nu.email, password: nu.password, displayName: nu.displayName, role: nu.role, canSecondApprove: nu.second || undefined } }), () => { toast.success("User created"); setNu({ email: "", password: "", displayName: "", role: "officer", second: false }); users.reload(); });
          }}
        >
          <label className="space-y-1.5"><span className="text-[15px]">Name</span><input className="field" required minLength={2} value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} /></label>
          <label className="space-y-1.5"><span className="text-[15px]">Email</span><input className="field" type="email" required value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} /></label>
          <label className="space-y-1.5"><span className="text-[15px]">Password (8+ characters)</span><input className="field" type="password" required minLength={8} autoComplete="new-password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></label>
          <label className="space-y-1.5"><span className="text-[15px]">Role</span>
            <select className="field" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as typeof nu.role })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          </label>
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={nu.second} onChange={(e) => setNu({ ...nu, second: e.target.checked })} className="size-5 accent-ink" /> Can give the second approval on large payouts</label>
          <div className="sm:col-span-2"><Btn type="submit" loading={busy === "nu"}>Create user</Btn></div>
        </form>
      </section>

      <section className="space-y-5">
        <SectionHeader title="API keys">For other systems that call the public API. The key is shown once.</SectionHeader>
        <ul className="stagger space-y-2">
          {keys.data?.keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-ink bg-white p-4">
              <span>
                <b>{k.name}</b> <span className="font-mono text-[13px] text-muted-ink">asli_{k.prefix}…</span> {k.scopes.map((s) => <Tag key={s} className="ms-1">{s}</Tag>)}
                {k.revokedAt && <Tag tone="dark" className="ms-1">revoked</Tag>}
              </span>
              {!k.revokedAt && (
                <Btn size="sm" variant="secondary" loading={busy === "k" + k.id} onClick={() => run("k" + k.id, () => api(`/admin/api-keys/${k.id}`, { method: "DELETE" }), () => { toast.success("Revoked"); keys.reload(); })}>Revoke</Btn>
              )}
            </li>
          ))}
        </ul>
        <form
          className="space-y-4 rounded-[28px] border border-ink bg-mist p-6 shadow-hard"
          onSubmit={(e) => {
            e.preventDefault();
            void run("nk", () => api<{ key: string }>("/admin/api-keys", { body: { name: kn, scopes: ks } }), (r) => { setShown(r.key); setKn(""); keys.reload(); });
          }}
        >
          <label className="block space-y-1.5"><span className="text-[15px]">Name</span><input className="field" required minLength={2} value={kn} onChange={(e) => setKn(e.target.value)} /></label>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-[15px]">Allowed to</legend>
            {keys.data?.availableScopes.map((s) => (
              <label key={s} className={"cursor-pointer rounded-full border border-ink px-3 py-1.5 text-[14px] " + (ks.includes(s) ? "bg-lime" : "bg-white")}>
                <input type="checkbox" className="sr-only" checked={ks.includes(s)} onChange={() => setKs(toggle(ks, s))} />{s}
              </label>
            ))}
          </fieldset>
          <Btn type="submit" loading={busy === "nk"} disabled={ks.length === 0}>Create key</Btn>
        </form>
        {shown && (
          <div role="status" className="space-y-2 rounded-[22px] border-2 border-ink bg-lime p-5">
            <p className="font-medium">Copy it now. You won&rsquo;t see it again. Send it as the <span className="font-mono">X-API-Key</span> header.</p>
            <input readOnly aria-label="New API key" className="field font-mono text-[13px]" value={shown} onFocus={(e) => e.currentTarget.select()} />
            <Btn size="sm" variant="inverse" onClick={() => { void navigator.clipboard?.writeText(shown); toast.success("Copied"); }}>Copy</Btn>
          </div>
        )}
      </section>

      <section className="space-y-5">
        <SectionHeader title="Webhooks">Tell another system when a case changes. Each delivery is signed and retried.</SectionHeader>
        <ul className="stagger space-y-2">
          {hooks.data?.webhooks.map((h) => (
            <li key={h.id} className="space-y-2 rounded-[18px] border border-ink bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="break-all font-mono text-[14px]">{h.url}</span>
                <span className="flex gap-2">
                  <Btn size="sm" variant="secondary" loading={busy === "t" + h.id} onClick={() => run("t" + h.id, () => api(`/admin/webhooks/${h.id}/test`, { method: "POST", body: {} }), () => { toast.success("Test sent"); hooks.reload(); })}>Send test</Btn>
                  <Btn size="sm" variant="secondary" loading={busy === "d" + h.id} onClick={() => run("d" + h.id, () => api(`/admin/webhooks/${h.id}`, { method: "DELETE" }), () => { toast.success("Disabled"); hooks.reload(); })}>Disable</Btn>
                </span>
              </div>
              <p className="flex flex-wrap gap-1.5">{h.events.map((e) => <Tag key={e}>{e}</Tag>)}</p>
              {(h.recent ?? h.deliveries ?? []).slice(0, 3).map((d, i) => (
                <p key={i} className="font-mono text-[12px] text-muted-ink">{fmtWhen(d.createdAt)} · {d.status}</p>
              ))}
            </li>
          ))}
        </ul>
        <form
          className="space-y-4 rounded-[28px] border border-ink bg-mist p-6 shadow-hard"
          onSubmit={(e) => {
            e.preventDefault();
            void run("nh", () => api<{ secret: string }>("/admin/webhooks", { body: { url: hu, events: he } }), (r) => { setHs(r.secret); setHu(""); hooks.reload(); });
          }}
        >
          <label className="block space-y-1.5"><span className="text-[15px]">URL that will receive events</span><input className="field" type="url" required placeholder="https://example.org/asli-events" value={hu} onChange={(e) => setHu(e.target.value)} /></label>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-[15px]">Events</legend>
            {hooks.data?.events.map((ev) => (
              <label key={ev} className={"cursor-pointer rounded-full border border-ink px-3 py-1.5 text-[14px] " + (he.includes(ev) ? "bg-lime" : "bg-white")}>
                <input type="checkbox" className="sr-only" checked={he.includes(ev)} onChange={() => setHe(toggle(he, ev))} />{ev}
              </label>
            ))}
          </fieldset>
          <Btn type="submit" loading={busy === "nh"} disabled={he.length === 0 || !hu}>Subscribe</Btn>
        </form>
        {hs && (
          <Panel className="space-y-2">
            <p className="font-medium">Signing secret (shown once). Check each delivery with HMAC-SHA256 of the timestamp and body.</p>
            <input readOnly aria-label="Webhook secret" className="field font-mono text-[13px]" value={hs} onFocus={(e) => e.currentTarget.select()} />
          </Panel>
        )}
      </section>
    </div>
  );
}
