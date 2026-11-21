"use client";

import * as React from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useApi, useAction, fmtPKR, fmtWhen } from "@/lib/hooks";
import { Btn, Card, CardTitle, Panel, Spinner, Stat, Tag, SectionHeader } from "@/components/brut/kit";

type Def = {
  thresholds: { fastLaneMinScore: number; askProofMinScore: number; secondApproverAbovePKR: number } & Record<string, unknown>;
  autoApprove: { maxAmountPKR: number; coolingOffHours: number; floor: number; enabled: boolean };
  eligibility: { id: string; value: number; label: { en: string } }[];
  costs: { wrongApprovalPKR: number } & Record<string, number>;
} & Record<string, unknown>;
type Sim = {
  casesReplayed: number;
  flips: { caseId: string; from: string; to: string; eligibleFrom: boolean | null; eligibleTo: boolean | null; amountFrom: number; amountTo: number }[];
  summary: { laneCounts: { before: Record<string, number | null>; after: Record<string, number | null> }; newlyEligible: number; newlyIneligible: number; extraHumanReviews: number; benefitDeltaPKR: number };
};
type Version = { id: string; version: number; status: string; note: string | null; createdAt: string };

const LANES = ["auto", "fast", "ask_proof", "human"] as const;
const num = (s: string) => (s === "" ? 0 : Number(s));

export default function DigitalTwin() {
  const active = useApi<{ definition: Def; version: number }>("/rules/active");
  const versions = useApi<{ versions: Version[] }>("/rules");
  const { busy, run } = useAction();
  const [d, setD] = React.useState<Def | null>(null);
  const [sim, setSim] = React.useState<{ title: string; r: Sim } | null>(null);
  const [killWhy, setKillWhy] = React.useState("");

  React.useEffect(() => {
    if (active.data) setD(structuredClone(active.data.definition));
  }, [active.data]);

  if (!d || !active.data) return <Spinner />;
  const income = d.eligibility.find((e) => e.id === "income_limit");
  const set = (fn: (x: Def) => void) => setD((cur) => { const n = structuredClone(cur!); fn(n); return n; });
  const drafts = (versions.data?.versions ?? []).filter((v) => v.status === "draft");

  return (
    <div className="space-y-14">
      <div>
        <h1 className="text-h1">
          Digital <span className="marker">Twin</span>
        </h1>
        <p className="mt-3 max-w-[44rem] text-lead text-muted-ink">Change a rule, replay it on every past case, and see who would flip and how much money moves. Nothing goes live until you publish.</p>
      </div>

      <section className="space-y-6">
        <SectionHeader title="Edit a draft">Starting from rule version {active.data.version}.</SectionHeader>
        <div className="grid gap-4 rounded-[28px] border border-ink bg-mist p-6 shadow-hard sm:grid-cols-2 lg:grid-cols-3">
          {income && (
            <Field label="Income limit (Rs / month)" value={income.value} onChange={(v) => set((x) => { x.eligibility.find((e) => e.id === "income_limit")!.value = num(v); })} />
          )}
          <Field label="Fast lane needs score ≥" step="0.01" value={d.thresholds.fastLaneMinScore} onChange={(v) => set((x) => { x.thresholds.fastLaneMinScore = num(v); })} />
          <Field label="Ask for proof from score ≥" step="0.01" value={d.thresholds.askProofMinScore} onChange={(v) => set((x) => { x.thresholds.askProofMinScore = num(v); })} />
          <Field label="Second approver above (Rs)" value={d.thresholds.secondApproverAbovePKR} onChange={(v) => set((x) => { x.thresholds.secondApproverAbovePKR = num(v); })} />
          <Field label="Provisional approval up to (Rs)" value={d.autoApprove.maxAmountPKR} onChange={(v) => set((x) => { x.autoApprove.maxAmountPKR = num(v); })} />
          <Field label="Cooling-off (hours)" value={d.autoApprove.coolingOffHours} onChange={(v) => set((x) => { x.autoApprove.coolingOffHours = num(v); })} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Btn loading={busy === "sim"} onClick={() => run("sim", () => api<Sim>("/rules/simulate", { body: { definition: d } }), (r) => setSim({ title: "Your edited rules", r }))}>
            Replay on past cases
          </Btn>
          <Btn variant="secondary" loading={busy === "draft"} onClick={() => run("draft", () => api("/rules/drafts", { body: { definition: d, note: "Edited in Digital Twin" } }), () => { toast.success("Saved as a draft"); versions.reload(); })}>
            Save as draft
          </Btn>
        </div>
      </section>

      {sim && <SimResult title={sim.title} r={sim.r} />}

      <section className="space-y-6">
        <SectionHeader title="Drafts">Replay a saved draft, then publish it. Publishing applies to the very next decision.</SectionHeader>
        {drafts.length === 0 && <p className="text-muted-ink">No drafts yet.</p>}
        <ul className="stagger space-y-3">
          {drafts.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-ink bg-white p-4">
              <span>
                <b>Version {v.version}</b> <Tag>draft</Tag> <span className="text-muted-ink">{v.note} · {fmtWhen(v.createdAt)}</span>
              </span>
              <span className="flex gap-2">
                <Btn size="sm" variant="secondary" loading={busy === "s" + v.id} onClick={() => run("s" + v.id, () => api<Sim>(`/rules/${v.id}/simulate`, { method: "POST", body: {} }), (r) => setSim({ title: `Draft version ${v.version}`, r }))}>
                  Replay
                </Btn>
                <Btn size="sm" loading={busy === "p" + v.id} onClick={() => run("p" + v.id, () => api(`/rules/${v.id}/publish`, { method: "POST", body: {} }), () => { toast.success(`Version ${v.version} is live`); active.reload(); versions.reload(); })}>
                  Publish
                </Btn>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Card tone="dark" reveal={false} className="space-y-4 p-6 sm:p-10">
        <CardTitle tone="dark">Fast-lane kill switch</CardTitle>
        <p className="text-white/85">Fast lane is <b>{(active.data.definition as { fastLaneEnabled?: boolean }).fastLaneEnabled === false ? "OFF" : "ON"}</b>. Turning it off sends every case to a person. It publishes a new rule version.</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input className="field text-black" aria-label="Reason" placeholder="Reason (required)" value={killWhy} onChange={(e) => setKillWhy(e.target.value)} />
          <Btn variant="inverse" disabled={killWhy.trim().length < 3} loading={busy === "kill"} onClick={() => run("kill", () => api("/rules/fast-lane", { body: { enabled: (active.data!.definition as { fastLaneEnabled?: boolean }).fastLaneEnabled === false, reason: killWhy } }), () => { toast.success("Fast lane switched"); setKillWhy(""); active.reload(); versions.reload(); })}>
            {(active.data.definition as { fastLaneEnabled?: boolean }).fastLaneEnabled === false ? "Turn ON" : "Turn OFF"}
          </Btn>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange, step }: { label: string; value: number; onChange: (v: string) => void; step?: string }) {
  const id = React.useId();
  return (
    <label className="space-y-1.5" htmlFor={id}>
      <span className="text-[15px]">{label}</span>
      <input id={id} className="field font-mono" type="number" step={step ?? "1"} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function SimResult({ title, r }: { title: string; r: Sim }) {
  const s = r.summary;
  return (
    <section className="space-y-6" aria-live="polite">
      <h2 className="text-h3">
        <span className="marker">{title}</span> <span className="text-[1rem] font-normal text-muted-ink">on {r.casesReplayed} past cases</span>
      </h2>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Panel><Stat value={r.flips.length} label="cases would change lane" /></Panel>
        <Panel><Stat value={s.newlyEligible} label="newly eligible" /></Panel>
        <Panel><Stat value={s.newlyIneligible} label="newly not eligible" /></Panel>
        <Panel><Stat value={(s.benefitDeltaPKR >= 0 ? "+" : "−") + fmtPKR(Math.abs(s.benefitDeltaPKR)).replace("Rs ", "")} label={`Rs change in money paid · ${s.extraHumanReviews >= 0 ? "+" : ""}${s.extraHumanReviews} human reviews`} /></Panel>
      </div>
      <div className="overflow-x-auto rounded-[22px] border border-ink bg-white">
        <table className="w-full min-w-[420px] text-left text-[15px]">
          <thead className="bg-ink text-white">
            <tr>
              <th className="p-3">Lane</th>
              <th className="p-3">Before</th>
              <th className="p-3">After</th>
            </tr>
          </thead>
          <tbody>
            {LANES.map((l) => (
              <tr key={l} className="border-t border-ink/15">
                <td className="p-3 font-mono">{l}</td>
                <td className="p-3">{s.laneCounts.before[l] ?? 0}</td>
                <td className="p-3 font-medium">{s.laneCounts.after[l] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.flips.length > 0 && (
        <ul className="space-y-2">
          {r.flips.map((f) => (
            <li key={f.caseId} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-ink bg-white p-3 text-[15px]">
              <span className="font-mono text-[13px]">{f.caseId.slice(-6)}</span>
              <Tag>{f.from}</Tag>→<Tag tone="lime">{f.to}</Tag>
              <span className="text-muted-ink">{fmtPKR(f.amountFrom)} → {fmtPKR(f.amountTo)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
