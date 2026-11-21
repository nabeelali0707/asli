"use client";

import { toast } from "sonner";
import { api } from "@/lib/api";
import { useApi, useAction, fmtWhen } from "@/lib/hooks";
import { Btn, Bilingual, Spinner, Tag, Empty, SectionHeader } from "@/components/brut/kit";

type Bi = { en: string; ur: string };
type Grant = { id: string; grantee: { name: string; type: string }; scopes: string[]; purpose: string; status: string; receiptText: Bi; receiptHash: string; createdAt: string; expiresAt: string | null; withdrawnAt: string | null };
type Log = { at: string; actorType: string; actorRole: string; action: string; outcome: string };

export default function ConsentPage() {
  const q = useApi<{ grants: Grant[]; accessLog: Log[] }>("/consent");
  const { busy, run } = useAction();
  if (q.loading && !q.data) return <Spinner />;
  return (
    <div className="space-y-16">
      <section>
        <h1 className="text-h1">
          Who can <span className="marker">see your data</span>
        </h1>
        <p className="mt-3 max-w-[40rem] text-lead text-muted-ink">You gave permission for each of these. Take it back at any time. It stops on the very next request.</p>
        <div className="stagger mt-8 space-y-5">
          {q.data?.grants.length === 0 && <Empty title="No permissions given" />}
          {q.data?.grants.map((g) => (
            <div key={g.id} className="rounded-[28px] border border-ink bg-white p-6 shadow-hard sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-medium">{g.grantee.name}</h2>
                <Tag tone={g.status === "active" ? "lime" : "dark"}>{g.status}</Tag>
              </div>
              <Bilingual className="mt-5" text={g.receiptText} />
              <p className="mt-4 font-mono text-[12px] text-muted-ink">Receipt {g.receiptHash.slice(0, 16)}… · given {fmtWhen(g.createdAt)}{g.withdrawnAt ? ` · withdrawn ${fmtWhen(g.withdrawnAt)}` : ""}</p>
              {g.status === "active" && (
                <Btn
                  className="mt-5"
                  variant="secondary"
                  loading={busy === g.id}
                  onClick={() => run(g.id, () => api(`/consent/${g.id}/withdraw`, { body: { reason: "Withdrawn by the person" } }), () => { toast.success("Permission taken back."); q.reload(); })}
                >
                  Take permission back
                </Btn>
              )}
            </div>
          ))}
        </div>
      </section>
      <section>
        <SectionHeader title="Who looked">Every time someone or something used your data.</SectionHeader>
        <ul className="stagger mt-8 divide-y divide-ink/15 rounded-[22px] border border-ink bg-white">
          {q.data?.accessLog.map((l, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[15px]">
              <span><span className="font-mono">{l.action}</span> <span className="text-muted-ink">by {l.actorType === "ai" ? "the AI engine" : l.actorRole}</span></span>
              <span className="text-muted-ink">{fmtWhen(l.at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
