"use client";

import { useApi } from "@/lib/hooks";
import { Card, CardTitle, Panel, Spinner, Stat, Tag } from "@/components/brut/kit";

type Rules = { version: number; definition: { program: { code: string; name: { en: string } }; thresholds: Record<string, unknown>; autoApprove: { floor: number; maxAmountPKR: number; coolingOffHours: number }; eligibility: { id: string; label: { en: string } }[] } };
type Thr = { formula: { threshold: number; formula: string }; ruleOfThree: string; curve: { threshold: number; costPerCasePKR: number; wrongAuto: number }[] };
type Scorer = { models: { version: number; metrics: { auc: number; ece: { calibrated: number; uncalibratedLogistic: number }; honesty: string } }[] };

export default function RulesPage() {
  const r = useApi<Rules>("/rules/active");
  const t = useApi<Thr>("/eval/auto-threshold");
  const s = useApi<Scorer>("/eval/scorer");
  if (!r.data || !t.data) return <Spinner />;
  const curve = t.data.curve;
  const maxC = Math.max(...curve.map((c) => c.costPerCasePKR));
  const minC = Math.min(...curve.map((c) => c.costPerCasePKR));
  const m = s.data?.models[0]?.metrics;
  return (
    <div className="space-y-12">
      <h1 className="text-h1">
        Rules &amp; <span className="marker">threshold</span>
      </h1>
      <Card tone="light" reveal={false} className="p-6 sm:p-10">
        <CardTitle>
          {r.data.definition.program.name.en} · v{r.data.version}
        </CardTitle>
        <ul className="stagger mt-5 grid gap-2 sm:grid-cols-2">
          {r.data.definition.eligibility.map((e) => (
            <li key={e.id} className="rounded-[14px] bg-mist px-4 py-3 text-[15px]">
              {e.label.en}
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[15px] text-muted-ink">
          Provisional approval up to Rs {r.data.definition.autoApprove.maxAmountPKR.toLocaleString()} · cooling-off {r.data.definition.autoApprove.coolingOffHours}h · second approver above Rs {String(r.data.definition.thresholds.secondApproverAbovePKR)}
        </p>
      </Card>
      <section className="space-y-5">
        <h2 className="text-h3">
          <span className="marker">Where the auto-approve line sits</span>
        </h2>
        <p className="max-w-[44rem] text-muted-ink">Set by what each mistake costs, not by feel. Bars show cost per case on a frozen synthetic test set at each threshold.</p>
        <Panel>
          <div className="flex h-44 items-end gap-[3px]" role="img" aria-label="Cost per case across thresholds">
            {curve.map((c) => (
              <div
                key={c.threshold}
                title={`${c.threshold}: Rs ${c.costPerCasePKR}`}
                className={"flex-1 rounded-t-[3px] border border-ink " + (c.threshold === t.data!.formula.threshold ? "bg-ink" : c.wrongAuto > 0 ? "bg-mist" : "bg-lime")}
                style={{ height: `${20 + ((c.costPerCasePKR - minC) / Math.max(1, maxC - minC)) * 80}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[12px] text-muted-ink">
            <span>{curve[0]?.threshold}</span>
            <span>threshold →</span>
            <span>{curve.at(-1)?.threshold}</span>
          </div>
          <p className="mt-4 break-words font-mono text-[13px]">{t.data.formula.formula}</p>
          <p className="mt-2 text-[15px] text-muted-ink">{t.data.ruleOfThree}</p>
          <p className="mt-3 flex flex-wrap gap-2 text-[13px]">
            <Tag tone="dark">chosen</Tag>
            <Tag tone="lime">no wrong approvals</Tag>
            <Tag>had wrong approvals</Tag>
          </p>
        </Panel>
      </section>
      {m && (
        <section className="stagger grid gap-5 sm:grid-cols-3">
          <Panel>
            <Stat value={m.auc.toFixed(2)} label="AUC (test split)" />
          </Panel>
          <Panel>
            <Stat value={m.ece.calibrated.toFixed(3)} label={`calibration error (was ${m.ece.uncalibratedLogistic.toFixed(3)})`} />
          </Panel>
          <Panel>
            <p className="text-[14px] text-muted-ink">{m.honesty}</p>
          </Panel>
        </section>
      )}
    </div>
  );
}
