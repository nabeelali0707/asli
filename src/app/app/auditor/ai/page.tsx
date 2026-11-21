"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { useApi, useAction, fmtWhen } from "@/lib/hooks";
import { Btn, Bilingual, Spinner, Tag } from "@/components/brut/kit";

type D = { id: string; kind: string; createdAt: string; citizenView: { en: string; ur: string } | null };

export default function AiDecisions() {
  const q = useApi<{ decisions: D[] }>("/ai-decisions");
  const [rep, setRep] = React.useState<Record<string, unknown>>({});
  const { busy, run } = useAction();
  return (
    <div className="space-y-8">
      <h1 className="text-h1">
        AI <span className="marker">decisions</span>
      </h1>
      <p className="max-w-[42rem] text-lead text-muted-ink">Every AI output is stored with its input. Replay one: the same rule version must give the same answer.</p>
      {!q.data && <Spinner />}
      <ul className="space-y-4">
        {q.data?.decisions.map((d) => (
          <li key={d.id} className="rounded-[22px] border border-ink bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Tag tone="mist">{d.kind}</Tag>
              <span className="text-[13px] text-muted-ink">{fmtWhen(d.createdAt)}</span>
            </div>
            {d.citizenView && <Bilingual className="mt-4" text={d.citizenView} speakable={false} />}
            <Btn className="mt-4" size="sm" variant="secondary" loading={busy === d.id} onClick={() => run(d.id, () => api(`/ai-decisions/${d.id}/replay`, { method: "POST", body: {} }), (r) => setRep((x) => ({ ...x, [d.id]: r })))}>
              Replay
            </Btn>
            {rep[d.id] !== undefined && <pre className="mt-3 max-h-56 overflow-auto rounded-[14px] bg-mist p-3 font-mono text-[12px]">{JSON.stringify(rep[d.id], null, 2)}</pre>}
          </li>
        ))}
      </ul>
    </div>
  );
}
