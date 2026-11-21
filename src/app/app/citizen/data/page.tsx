"use client";

import * as React from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAction, useSession, fmtWhen } from "@/lib/hooks";
import { Btn, Tag, SectionHeader } from "@/components/brut/kit";

const FIELDS = [
  ["fullName", "My name"],
  ["fatherName", "Father's name"],
  ["dob", "Date of birth"],
  ["district", "District"],
  ["phone", "Phone number"],
  ["payoutAlias", "Account for payments"],
] as const;
const CLAIMS = [
  ["identity_verified", "My identity is verified"],
  ["eligible_under_current_rules", "I qualify under the current rules"],
  ["payment_received", "I received my payment"],
] as const;

type Attest = { id: string; claim: string; value: boolean; audience: string; token: string; expiresAt: string; sharedData: string };
type Verified = { valid: boolean; reason?: string; claim?: string; value?: boolean; audience?: string; expiresAt?: string };

export default function MyDetails() {
  const s = useSession();
  const { busy, run } = useAction();
  const [field, setField] = React.useState<(typeof FIELDS)[number][0]>("district");
  const [val, setVal] = React.useState("");
  const [why, setWhy] = React.useState("");
  const [claim, setClaim] = React.useState<(typeof CLAIMS)[number][0]>("eligible_under_current_rules");
  const [aud, setAud] = React.useState("");
  const [att, setAtt] = React.useState<Attest | null>(null);
  const [tok, setTok] = React.useState("");
  const [ver, setVer] = React.useState<Verified | null>(null);
  const cid = s?.user.citizenId;

  return (
    <div className="max-w-3xl space-y-16">
      <section className="space-y-6">
        <h1 className="text-h1">
          My <span className="marker">details</span>
        </h1>
        <SectionHeader title="Fix a detail">Something wrong in your record? Ask for a correction. An officer reviews it before anything changes.</SectionHeader>
        <form
          className="grid gap-4 rounded-[28px] border border-ink bg-mist p-6 shadow-hard sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("corr", () => api("/consent/corrections", { body: { field, requestedValue: val, reason: why || undefined } }), () => {
              toast.success("Sent to an officer");
              setVal("");
              setWhy("");
            });
          }}
        >
          <label className="space-y-1.5">
            <span className="text-[15px]">What is wrong</span>
            <select className="field" value={field} onChange={(e) => setField(e.target.value as typeof field)}>
              {FIELDS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[15px]">It should say</span>
            <input className="field" value={val} onChange={(e) => setVal(e.target.value)} required />
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-[15px]">Why (optional)</span>
            <input className="field" value={why} onChange={(e) => setWhy(e.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <Btn type="submit" loading={busy === "corr"} disabled={!val.trim()}>
              Ask for a correction
            </Btn>
          </div>
        </form>
      </section>

      <section className="space-y-6">
        <SectionHeader title="Prove, don't share">Another office only needs a yes or no. Give them a signed answer instead of your papers: they never see your income, ID number or documents.</SectionHeader>
        <form
          className="grid gap-4 rounded-[28px] border border-ink bg-white p-6 shadow-hard sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!cid) return;
            void run("att", () => api<Attest>(`/citizens/${cid}/attestations`, { body: { claim, audience: aud } }), setAtt);
          }}
        >
          <label className="space-y-1.5">
            <span className="text-[15px]">What to prove</span>
            <select className="field" value={claim} onChange={(e) => setClaim(e.target.value as typeof claim)}>
              {CLAIMS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[15px]">Who is it for</span>
            <input className="field" value={aud} onChange={(e) => setAud(e.target.value)} placeholder="health-department" required minLength={2} />
          </label>
          <div className="sm:col-span-2">
            <Btn type="submit" loading={busy === "att"} disabled={!cid || aud.trim().length < 2}>
              Make a signed yes/no
            </Btn>
          </div>
        </form>
        {att && (
          <div className="space-y-3 rounded-[28px] border border-ink bg-lime p-6">
            <div className="flex flex-wrap gap-2">
              <Tag tone="white">{att.value ? "YES" : "NO"}</Tag>
              <Tag tone="white">for {att.audience}</Tag>
              <Tag tone="white">expires {fmtWhen(att.expiresAt)}</Tag>
            </div>
            <p className="text-[15px]">Shared data: <b>{att.sharedData}</b></p>
            <textarea readOnly aria-label="Signed token" className="field font-mono text-[12px]" rows={3} value={att.token} onFocus={(e) => e.currentTarget.select()} />
            <Btn
              variant="inverse"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(att.token);
                toast.success("Copied");
              }}
            >
              Copy
            </Btn>
          </div>
        )}
        <div className="space-y-3 rounded-[28px] border border-ink bg-mist p-6">
          <h3 className="font-medium">Check a signed answer someone gave you</h3>
          <textarea aria-label="Token to check" className="field font-mono text-[12px]" rows={2} value={tok} onChange={(e) => setTok(e.target.value)} placeholder="ASLI1.…" />
          <Btn variant="secondary" size="sm" disabled={tok.trim().length < 10} loading={busy === "ver"} onClick={() => run("ver", () => api<Verified>("/attestations/verify", { body: { token: tok.trim() }, anonymous: true }), setVer)}>
            Check it
          </Btn>
          {ver && (
            <p role="status" className="text-[15px]">
              <Tag tone={ver.valid ? "lime" : "dark"}>{ver.valid ? "genuine" : "not valid"}</Tag>{" "}
              {ver.valid ? `${ver.claim?.replace(/_/g, " ")}: ${ver.value ? "yes" : "no"} (for ${ver.audience})` : ver.reason}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
