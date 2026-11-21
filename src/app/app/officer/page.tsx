"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useApi, fmtWhen } from "@/lib/hooks";
import { LaneChip, Spinner, Empty, Tag } from "@/components/brut/kit";
import { cn } from "@/lib/utils";

type Row = { id: string; ref: string; status: string; lane: string; priority: number; confidence: number | null; createdAt: string; citizen: { fullName: string; district: string } };
const FILTERS = [["all", "All"], ["human", "I am not sure"], ["fast", "Pre-verified"], ["ask_proof", "Needs a thing"], ["auto", "Provisional"]] as const;

export default function OfficerQueue() {
  const q = useApi<{ cases: Row[] }>("/officer/queue");
  const [f, setF] = React.useState<string>("all");
  const rows = (q.data?.cases ?? []).filter((r) => f === "all" || r.lane === f);
  return (
    <div className="space-y-8">
      <h1 className="text-h1">The <span className="marker">queue</span></h1>
      <p className="max-w-[40rem] text-lead text-muted-ink">Sorted by urgency. The AI only ever sends cases here or asks for proof. It cannot approve a payout.</p>
      <div role="tablist" aria-label="Filter by lane" className="flex flex-wrap gap-2">
        {FILTERS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={f === k} onClick={() => setF(k)} className={cn("rounded-full border border-ink px-4 py-2 text-[15px] transition-colors", f === k ? "bg-ink text-white" : "bg-white hover:bg-lime")}>{l}</button>
        ))}
      </div>
      {q.loading && <Spinner />}
      {!q.loading && rows.length === 0 && <Empty title="Nothing in this lane" />}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/app/officer/case?id=${r.id}`} className="group grid items-center gap-3 rounded-[22px] border border-ink bg-white p-5 shadow-hard transition-transform hover:-translate-y-0.5 sm:grid-cols-[6rem_1fr_auto_auto]">
              <span className="font-mono text-lg">{r.ref}</span>
              <span><span className="font-medium">{r.citizen.fullName}</span> <span className="text-muted-ink">· {r.citizen.district} · {fmtWhen(r.createdAt)}</span></span>
              <span className="flex items-center gap-2"><LaneChip lane={r.lane} /><Tag>{r.status.replace("_", " ")}</Tag></span>
              <span className="hidden items-center gap-2 font-mono text-[13px] text-muted-ink sm:flex">p {r.confidence?.toFixed(2) ?? "—"}<ArrowUpRight className="size-5 transition-transform group-hover:rotate-45" /></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
