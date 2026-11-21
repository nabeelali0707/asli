"use client";

import * as React from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useApi, useAction, fmtPKR, fmtWhen } from "@/lib/hooks";
import { Btn, Card, CardTitle, Panel, Spinner, Stat, Tag, SectionHeader } from "@/components/brut/kit";

type Metrics = { expectedCostPerCasePKR: number; automationRate: number; wrongFastLane: number; falseAlarms: number; falseAlarmRate: number; humanReviewShare: number; confusion: Record<string, Record<string, number>> };
type Run = {
  id: string;
  createdAt?: string;
  metrics: {
    syntheticCases: number;
    heldOutCases: number;
    current: { thresholds: { fast: number; ask: number }; heldOut: Metrics };
    recommended: { thresholds: { fast: number; ask: number }; heldOut: Metrics };
    honesty: { note: string; wrongApprovalUpperBound95: string; breakEvenForActingAlone: string };
  };
  curve: { fastLaneMinScore: number; expectedCostPerCasePKR: number; automationRate: number }[];
};
type Drift = { tripped: boolean; fastLaneEnabled: boolean; stats: { fastLaneDecided: number; fastLaneRejectedByOfficer: number; fastLaneOverrideRate: number | null }; limits: { minSamples: number; maxFastLaneOverrideRate: number }; action: string | null };
type Scorer = { models: { metrics: { ece: { calibrated: number; uncalibratedLogistic: number }; reliabilityTest: { bin: string; n: number; meanPredicted: number; observed: number }[]; reliabilityUncalibrated: { bin: string; n: number; meanPredicted: number; observed: number }[] } }[] };

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function EvalPage() {
  const scorer = useApi<Scorer>("/eval/scorer");
  const [run_, setRun] = React.useState<Run | null>(null);
  const [drift, setDrift] = React.useState<Drift | null>(null);
  const { busy, run } = useAction();
  const m = scorer.data?.models[0]?.metrics;

  return (
    <div className="space-y-16">
      <div>
        <h1 className="text-h1">
          Eval &amp; <span className="marker">drift</span>
        </h1>
        <p className="mt-3 max-w-[44rem] text-lead text-muted-ink">Fit the lane cutoffs by what mistakes cost, test them on cases the fit never saw, and watch whether live officers keep overturning the fast lane.</p>
      </div>

      <section className="space-y-6">
        <SectionHeader title="Run an evaluation">200 labelled synthetic cases. 160 to fit, 40 held out to report on.</SectionHeader>
        <Btn variant="lime" loading={busy === "eval"} onClick={() => run("eval", () => api<Run>("/eval/runs", { body: {} }), setRun)}>
          Run evaluation
        </Btn>
        {run_ && <EvalResult r={run_} onDraft={() => run("draft", () => api(`/eval/runs/${run_.id}/draft-rules`, { method: "POST", body: {} }), () => toast.success("Draft created. Review it in Digital Twin."))} drafting={busy === "draft"} />}
      </section>

      <section className="space-y-6">
        <SectionHeader title="Drift guard">If officers overturn more than {drift ? pct(drift.limits.maxFastLaneOverrideRate) : "10%"} of fast-lane cases, the fast lane switches itself off.</SectionHeader>
        <Btn variant="secondary" loading={busy === "drift"} onClick={() => run("drift", () => api<Drift>("/drift/check", { method: "POST", body: {} }), setDrift)}>
          Check now
        </Btn>
        {drift && (
          <Card tone={drift.tripped ? "dark" : "light"} reveal={false} className="space-y-3 p-6 sm:p-8">
            <CardTitle tone={drift.tripped ? "dark" : "light"}>{drift.tripped ? "Tripped: fast lane is off" : "Within limits"}</CardTitle>
            <p>
              Fast-lane decisions so far: <b>{drift.stats.fastLaneDecided}</b> · overturned by officers: <b>{drift.stats.fastLaneRejectedByOfficer}</b> · override rate: <b>{drift.stats.fastLaneOverrideRate == null ? "not enough data" : pct(drift.stats.fastLaneOverrideRate)}</b>
            </p>
            <p className={drift.tripped ? "text-white/80" : "text-muted-ink"}>Needs at least {drift.limits.minSamples} decided cases before it can trip. Fast lane is currently {drift.fastLaneEnabled ? "ON" : "OFF"}.</p>
          </Card>
        )}
      </section>

      <section className="space-y-6">
        <SectionHeader title="Calibration">When the scorer says 80%, is it right about 80% of the time? Bars close to the diagonal mean yes.</SectionHeader>
        {scorer.loading && !scorer.data ? <Spinner /> : !m ? (
          <div className="space-y-3 rounded-[22px] border border-dashed border-ink bg-mist p-6">
            <p className="font-medium">No scorer is trained for this department yet.</p>
            <p className="text-muted-ink">Training fits a logistic model on the frozen synthetic set and calibrates it, then shows these plots.</p>
            <Btn loading={busy === "train"} onClick={() => run("train", () => api("/eval/scorer/train", { method: "POST", body: {} }), () => { toast.success("Scorer trained"); scorer.reload(); })}>Train the scorer</Btn>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <Reliability title="After calibration" bins={m.reliabilityTest} ece={m.ece.calibrated} />
            <Reliability title="Before calibration" bins={m.reliabilityUncalibrated} ece={m.ece.uncalibratedLogistic} />
          </div>
        )}
      </section>
    </div>
  );
}

function EvalResult({ r, onDraft, drafting }: { r: Run; onDraft: () => void; drafting: boolean }) {
  const cur = r.metrics.current.heldOut;
  const rec = r.metrics.recommended.heldOut;
  const costs = r.curve.map((c) => c.expectedCostPerCasePKR);
  const lo = Math.min(...costs), hi = Math.max(...costs);
  const W = 560, H = 160;
  const pts = r.curve.map((c, i) => `${(i / Math.max(1, r.curve.length - 1)) * W},${H - 12 - ((c.expectedCostPerCasePKR - lo) / Math.max(1, hi - lo)) * (H - 28)}`).join(" ");
  const rows: [string, string, string][] = [
    ["Cost per case", fmtPKR(cur.expectedCostPerCasePKR), fmtPKR(rec.expectedCostPerCasePKR)],
    ["Handled without a person", pct(cur.automationRate), pct(rec.automationRate)],
    ["Wrong fast-lane approvals", String(cur.wrongFastLane), String(rec.wrongFastLane)],
    ["False alarms (real claimants slowed)", `${cur.falseAlarms} (${pct(cur.falseAlarmRate)})`, `${rec.falseAlarms} (${pct(rec.falseAlarmRate)})`],
    ["Sent to a person", pct(cur.humanReviewShare), pct(rec.humanReviewShare)],
  ];
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-[22px] border border-ink bg-white">
        <table className="w-full min-w-[520px] text-left text-[15px]">
          <thead className="bg-ink text-white">
            <tr>
              <th className="p-3">On {r.metrics.heldOutCases} held-out cases</th>
              <th className="p-3">Now (fast {r.metrics.current.thresholds.fast}, ask {r.metrics.current.thresholds.ask})</th>
              <th className="p-3">Recommended (fast {r.metrics.recommended.thresholds.fast}, ask {r.metrics.recommended.thresholds.ask})</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([a, b, c]) => (
              <tr key={a} className="border-t border-ink/15">
                <td className="p-3">{a}</td>
                <td className="p-3 font-mono">{b}</td>
                <td className="p-3 font-mono font-medium">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <h3 className="mb-3 font-medium">Where each lane sent the held-out cases</h3>
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="text-muted-ink">
                <th className="py-1">Lane</th>
                <th>Should pay</th>
                <th>Should not</th>
                <th>Needs info</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(rec.confusion).map(([lane, v]) => (
                <tr key={lane} className="border-t border-ink/10 font-mono">
                  <td className="py-1.5 font-sans">{lane}</td>
                  <td>{v.should_pay}</td>
                  <td className={lane === "fast" && v.should_not_pay > 0 ? "bg-ink text-white" : ""}>{v.should_not_pay}</td>
                  <td>{v.needs_info}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel>
          <h3 className="mb-3 font-medium">Cost per case as the fast-lane cutoff moves</h3>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Cost per case against fast lane cutoff">
            <polyline points={pts} fill="none" stroke="#191A23" strokeWidth="2" strokeLinejoin="round" />
            <text x="0" y={H - 1} fontSize="11" fontFamily="monospace" fill="#4b4c55">{r.curve[0]?.fastLaneMinScore}</text>
            <text x={W} y={H - 1} fontSize="11" fontFamily="monospace" fill="#4b4c55" textAnchor="end">{r.curve.at(-1)?.fastLaneMinScore}</text>
          </svg>
        </Panel>
      </div>
      <div className="space-y-2 rounded-[22px] border border-ink bg-mist p-5 text-[15px]">
        <p><Tag tone="dark">honest note</Tag> {r.metrics.honesty.note}</p>
        <p>{r.metrics.honesty.wrongApprovalUpperBound95}</p>
        <p>{r.metrics.honesty.breakEvenForActingAlone}</p>
      </div>
      <Btn variant="secondary" loading={drafting} onClick={onDraft}>
        Turn the recommended cutoffs into a rule draft
      </Btn>
    </div>
  );
}

function Reliability({ title, bins, ece }: { title: string; bins: { bin: string; n: number; meanPredicted: number; observed: number }[]; ece: number }) {
  const S = 220;
  const used = bins.filter((b) => b.n > 0);
  return (
    <Panel>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">{title}</h3>
        <Tag tone="mist">ECE {ece.toFixed(3)}</Tag>
      </div>
      <svg viewBox={`0 0 ${S} ${S}`} className="h-auto w-full max-w-[280px]" role="img" aria-label={`${title}: predicted versus observed`}>
        <rect x="0" y="0" width={S} height={S} fill="#F3F3F3" stroke="#191A23" />
        <line x1="0" y1={S} x2={S} y2="0" stroke="#191A23" strokeDasharray="4 4" />
        {used.map((b) => (
          <circle key={b.bin} cx={b.meanPredicted * S} cy={S - b.observed * S} r={3 + Math.min(8, Math.sqrt(b.n))} fill="#B9FF66" stroke="#191A23" strokeWidth="1.5">
            <title>{`${b.bin}: said ${Math.round(b.meanPredicted * 100)}%, was right ${Math.round(b.observed * 100)}% (n=${b.n})`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-2 text-[13px] text-muted-ink">Across: what the scorer said. Up: how often it was right. On the dashed line is perfect.</p>
    </Panel>
  );
}
