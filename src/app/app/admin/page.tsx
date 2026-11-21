"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApi, useAction } from "@/lib/hooks";
import { Btn, Card, Tag, Spinner, CountUp } from "@/components/brut/kit";

type Res = { id: string; kind: string; name: string; expect: string; actual: string; passed: boolean };
type Run = { summary: { attacksCaught: { count: number; of: number }; legitimateControlsPassed: { count: number; of: number } }; results: Res[] };

export default function BreakIt() {
  const list = useApi<{ items: { id: string; kind: string; name: string; expect: string }[] }>("/redteam/attacks");
  const [r, setR] = React.useState<Run | null>(null);
  const { busy, run } = useAction();
  const by = new Map(r?.results.map((x) => [x.id, x]));
  return (
    <div className="space-y-10">
      <h1 className="text-h1">
        Try to <span className="marker">break it</span>
      </h1>
      <p className="max-w-[42rem] text-lead text-muted-ink">Each row is a real attack or a legitimate control, run against the live API. Attacks must be caught; controls must still pass.</p>
      <Btn variant="lime" loading={busy === "all"} onClick={() => run("all", () => api<Run>("/redteam/run-all", { method: "POST", body: {} }), setR)}>
        Run all {list.data?.items.length ?? ""}
      </Btn>
      {r && (
        <Card tone="dark" reveal={false} className="grid gap-6 p-8 sm:grid-cols-2">
          <div>
            <div className="font-mono text-5xl text-lime">
              <CountUp to={r.summary.attacksCaught.count} />/{r.summary.attacksCaught.of}
            </div>
            <p className="mt-2 text-white/80">attacks caught</p>
          </div>
          <div>
            <div className="font-mono text-5xl text-lime">
              <CountUp to={r.summary.legitimateControlsPassed.count} />/{r.summary.legitimateControlsPassed.of}
            </div>
            <p className="mt-2 text-white/80">legitimate cases still pass</p>
          </div>
        </Card>
      )}
      {!list.data && <Spinner />}
      <ul className="stagger space-y-2">
        {list.data?.items.map((a) => {
          const x = by.get(a.id);
          return (
            <motion.li key={a.id} layout className="flex flex-wrap items-center gap-4 rounded-[18px] border border-ink bg-white p-4">
              <span className="font-mono text-sm text-muted-ink">{a.id}</span>
              <span className="min-w-[12rem] flex-1">{a.name}</span>
              <Tag tone={a.kind === "attack" ? "dark" : "mist"}>{a.kind}</Tag>
              <span className="w-28 text-right font-mono text-[13px]">{x ? x.actual : a.expect}</span>
              <motion.span key={x ? (x.passed ? "p" : "f") : "n"} initial={x ? { scale: 0, rotate: -90 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 18 }} className={"grid size-8 place-items-center rounded-full border border-ink " + (x ? (x.passed ? "bg-lime" : "bg-ink text-white") : "bg-mist")}>
                {x ? x.passed ? <Check className="size-4" aria-label="passed" /> : <X className="size-4" aria-label="failed" /> : null}
              </motion.span>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
