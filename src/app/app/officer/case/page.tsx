"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useApi, useAction, useSession, fmtPKR, fmtWhen } from "@/lib/hooks";
import { Btn, Card, CardTitle, Bilingual, LaneChip, Spinner, Tag, Panel } from "@/components/brut/kit";

type Bi = { en: string; ur: string };
type Detail = {
  case: { id: string; ref: string; status: string; statusWords: Bi; lane: string; confidence: number | null; claim: Record<string, unknown>; createdVia: string };
  citizen: { id: string; fullName: string; district: string; cnic: string };
  documents: { id: string; kind: string; checks: { tamperScore: number; tamperReasons: string[]; blurry: boolean; reusedByAnotherApplicant: boolean; notChecked: string[]; qr: { found: boolean; valid: boolean; reason?: string } } }[];
  decisions: { id: string; createdAt: string; lane: string; score: number; ruleVersion: number; reasonCodes: string[]; hardStops: string[]; userReason: Bi; trace: { autoApprove: { blockers: string[]; threshold: number; derivedFrom: string }; thresholds: Record<string, unknown> } }[];
  notes: { id: string; authorType: string; kind: string; body: string; createdAt: string }[];
  payout: { id: string; amount: number; status: string; requiredApprovals: number; approvals: { userId: string }[]; coolingOffUntil: string | null; provisional: boolean } | null;
};

const PROOF = ["cnic", "income_proof", "father_name", "dob", "retake_photo"] as const;

export default function CaseDetail() {
  const id = useSearchParams().get("id");
  const s = useSession();
  const q = useApi<Detail>(id ? `/cases/${id}` : null);
  const { busy, run } = useAction();
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  if (!id) return <p>No case selected.</p>;
  if (!q.data) return <Spinner />;
  const d = q.data;
  const dec = d.decisions[0];
  const after = (msg: string) => () => { toast.success(msg); q.reload(); };
  const canSecond = !!s?.user.canSecondApprove;

  return (
    <div className="stagger space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-muted-ink">Case {d.case.ref}</p>
          <h1 className="text-h1">{d.citizen.fullName}</h1>
          <p className="text-muted-ink">{d.citizen.district} · <span className="font-mono">{d.citizen.cnic}</span> · via {d.case.createdVia}</p>
        </div>
        <div className="flex gap-2"><LaneChip lane={d.case.lane} /><Tag>{d.case.statusWords.en}</Tag></div>
      </div>

      {dec && (
        <Card tone="dark" reveal={false} className="p-6 sm:p-10">
          <CardTitle tone="dark">Why the AI was {dec.hardStops.length ? "not sure" : "confident"}</CardTitle>
          <div className="mt-6 grid gap-8 lg:grid-cols-2">
            <div className="space-y-4">
              <Bilingual text={dec.userReason} tone="dark" />
              <p className="font-mono text-sm text-white/70">rule v{dec.ruleVersion} · score {dec.score} · {dec.reasonCodes.join(", ")}</p>
            </div>
            <div className="space-y-4">
              {dec.hardStops.length > 0 && (
                <div><p className="mb-2 text-sm uppercase tracking-wide text-white/70">Hard stops</p><div className="flex flex-wrap gap-2">{dec.hardStops.map((h) => <span key={h} className="rounded-[7px] bg-lime px-2 py-1 font-mono text-sm text-black">{h}</span>)}</div></div>
              )}
              <div>
                <p className="mb-2 text-sm uppercase tracking-wide text-white/70">Auto-approve blockers</p>
                <ul className="list-disc space-y-1 ps-5 text-[15px]">{dec.trace.autoApprove.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                <p className="mt-2 break-words font-mono text-[12px] text-white/60">{dec.trace.autoApprove.derivedFrom}</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      <section className="space-y-4">
        <h2 className="text-h3"><span className="marker">Documents</span></h2>
        <div className="grid gap-4 md:grid-cols-2">
          {d.documents.map((doc) => (
            <Panel key={doc.id}>
              <div className="flex items-center justify-between"><span className="font-medium capitalize">{doc.kind.replace("_", " ")}</span><Tag tone={doc.checks.tamperScore > 0.5 ? "dark" : "lime"}>tamper {doc.checks.tamperScore}</Tag></div>
              <ul className="mt-3 list-disc space-y-1 ps-5 text-[15px] text-muted-ink">
                {doc.checks.tamperReasons.map((r) => <li key={r}>{r}</li>)}
                {doc.checks.reusedByAnotherApplicant && <li>Image used by another applicant</li>}
                {doc.checks.blurry && <li>Blurry photo</li>}
              </ul>
              {doc.checks.notChecked.length > 0 && <p className="mt-3 text-[13px] text-muted-ink">Not checked: {doc.checks.notChecked.join("; ")}</p>}
            </Panel>
          ))}
        </div>
      </section>

      {d.payout && (
        <Card tone="lime" reveal={false} className="p-6 sm:p-10">
          <CardTitle tone="lime">Payout {fmtPKR(d.payout.amount)}</CardTitle>
          <p className="mt-4">Status <b>{d.payout.status.replace("_", " ")}</b> · approvals {d.payout.approvals.length}/{d.payout.requiredApprovals}{d.payout.coolingOffUntil ? ` · cooling off until ${fmtWhen(d.payout.coolingOffUntil)}` : ""}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {d.payout.status === "pending_approval" && (
              <Btn disabled={!canSecond} loading={busy === "second"} onClick={() => run("second", () => api(`/payouts/${d.payout!.id}/approve`, { method: "POST", body: {} }), after("Second approval recorded"))}>
                {canSecond ? "Give second approval" : "Needs a second approver"}
              </Btn>
            )}
            {["approved", "reserved"].includes(d.payout.status) && (
              <Btn loading={busy === "release"} onClick={() => run("release", () => api(`/payouts/${d.payout!.id}/release`, { method: "POST", body: {} }), after("Released via mock Raast"))}>Release money</Btn>
            )}
            {["pending_approval", "approved", "reserved"].includes(d.payout.status) && (
              <Btn variant="secondary" loading={busy === "cancel"} onClick={() => run("cancel", () => api(`/payouts/${d.payout!.id}/cancel`, { body: { reason: "Cancelled by officer" } }), after("Payout cancelled"))}>Cancel payout</Btn>
            )}
          </div>
        </Card>
      )}

      {!d.payout && ["in_review", "needs_proof", "submitted"].includes(d.case.status) && (
        <section className="space-y-5 rounded-[28px] border border-ink bg-mist p-6 shadow-hard sm:p-8">
          <h2 className="text-h3">Your decision</h2>
          <div className="flex flex-wrap gap-3">
            <Btn loading={busy === "approve"} onClick={() => run("approve", () => api(`/cases/${id}/approve`, { body: {} }), (r: any) => { toast.success(r.released ? "Approved and released" : `Approved — ${r.approvals}/${r.requiredApprovals} approvals`); q.reload(); })}>Approve</Btn>
            {PROOF.slice(0, 3).map((p) => (
              <Btn key={p} variant="secondary" size="sm" loading={busy === p} onClick={() => run(p, () => api(`/cases/${id}/request-proof`, { body: { items: [p] } }), after("Asked for " + p.replace("_", " ")))}>Ask for {p.replace("_", " ")}</Btn>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input className="field" aria-label="Reason for rejecting" placeholder="Reason (the person can appeal)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Btn variant="secondary" disabled={reason.trim().length < 3} loading={busy === "reject"} onClick={() => run("reject", () => api(`/cases/${id}/reject`, { body: { reason } }), after("Rejected"))}>Reject</Btn>
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-h3"><span className="marker">Notes</span></h2>
        <ul className="space-y-2">{d.notes.map((n) => <li key={n.id} className="rounded-[18px] border border-ink bg-white p-4 text-[15px]"><Tag tone={n.authorType === "ai" ? "mist" : "lime"}>{n.authorType} · {n.kind}</Tag><p className="mt-2">{n.body}</p></li>)}</ul>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input className="field" aria-label="Add a note" placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
          <Btn variant="secondary" disabled={!note.trim()} loading={busy === "note"} onClick={() => run("note", () => api(`/cases/${id}/notes`, { body: { body: note } }), () => { setNote(""); q.reload(); })}>Add</Btn>
        </div>
      </section>
    </div>
  );
}
