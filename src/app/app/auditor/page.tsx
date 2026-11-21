"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { useApi, useAction, fmtWhen } from "@/lib/hooks";
import { Btn, Spinner, Tag } from "@/components/brut/kit";

type E = { seq: number; at: string; actorRole: string; action: string; outcome: string; hash: string };

export default function AuditPage() {
  const q = useApi<{ entries: E[] }>("/audit");
  const [v, setV] = React.useState<{ ok: boolean; checked: number } | null>(null);
  const { busy, run } = useAction();
  return (
    <div className="space-y-8">
      <h1 className="text-h1">
        Audit <span className="marker">log</span>
      </h1>
      <div className="flex flex-wrap items-center gap-4">
        <Btn loading={busy === "v"} onClick={() => run("v", () => api<{ ok: boolean; checked: number }>("/audit/verify"), setV)}>
          Verify the chain
        </Btn>
        {v && <Tag tone={v.ok ? "lime" : "dark"}>{v.ok ? `Intact — ${v.checked} entries checked` : "Chain broken"}</Tag>}
      </div>
      {!q.data && <Spinner />}
      <div className="overflow-x-auto rounded-[22px] border border-ink bg-white">
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <thead className="bg-ink text-white">
            <tr>
              <th className="p-3">#</th>
              <th className="p-3">When</th>
              <th className="p-3">Who</th>
              <th className="p-3">Action</th>
              <th className="p-3">Outcome</th>
              <th className="p-3">Hash</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.entries.map((e) => (
              <tr key={e.seq} className="border-t border-ink/15">
                <td className="p-3 font-mono">{e.seq}</td>
                <td className="p-3">{fmtWhen(e.at)}</td>
                <td className="p-3">{e.actorRole}</td>
                <td className="p-3 font-mono">{e.action}</td>
                <td className="p-3">{e.outcome}</td>
                <td className="p-3 font-mono text-[12px] text-muted-ink">{e.hash.slice(0, 10)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
