"use client";

import { toast } from "sonner";
import { api } from "@/lib/api";
import { useApi, useAction, fmtWhen } from "@/lib/hooks";
import { Btn, Spinner, Empty, Tag, SectionHeader } from "@/components/brut/kit";

type Inbox = {
  complaints: { id: string; ref: string; status: string; createdAt: string }[];
  corrections: { id: string; field: string; requestedValue: string; reason?: string }[];
  payoutAccountChanges: { id: string; newAlias: string; status: string; createdAt: string; citizenId: string }[];
  scamReportsToReview: { id: string; verdict: string; category: string; textPreview?: string }[];
  counts: Record<string, number>;
};

export default function Inbox() {
  const q = useApi<Inbox>("/officer/complaints");
  const { busy, run } = useAction();
  const done = (m: string) => () => {
    toast.success(m);
    q.reload();
  };
  if (!q.data) return <Spinner />;
  const d = q.data;
  const empty = Object.values(d.counts).every((n) => n === 0);
  return (
    <div className="space-y-12">
      <h1 className="text-h1">
        Complaints &amp; <span className="marker">changes</span>
      </h1>
      {empty && <Empty title="Inbox is clear">Reports that money did not arrive, correction requests and payout account changes land here.</Empty>}
      {d.complaints.length > 0 && (
        <section>
          <SectionHeader title="Complaints" />
          <ul className="stagger mt-6 space-y-3">
            {d.complaints.map((c) => (
              <li key={c.id} className="rounded-[18px] border border-ink bg-white p-4">
                Case <b className="font-mono">{c.ref}</b> <Tag>{c.status}</Tag> <span className="text-muted-ink">{fmtWhen(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {d.payoutAccountChanges.length > 0 && (
        <section>
          <SectionHeader title="Payout account changes">Money cannot go to a changed account for 48 hours.</SectionHeader>
          <ul className="stagger mt-6 space-y-3">
            {d.payoutAccountChanges.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-ink bg-white p-4">
                <span>
                  New account <b className="font-mono">{c.newAlias}</b> <Tag>{c.status}</Tag>
                </span>
                <span className="flex gap-2">
                  <Btn size="sm" loading={busy === "a" + c.id} onClick={() => run("a" + c.id, () => api(`/payout-account/changes/${c.id}/approve`, { method: "POST", body: {} }), done("Approved"))}>
                    Approve
                  </Btn>
                  <Btn size="sm" variant="secondary" loading={busy === "f" + c.id} onClick={() => run("f" + c.id, () => api(`/payout-account/changes/${c.id}/freeze`, { method: "POST", body: {} }), done("Frozen"))}>
                    Freeze
                  </Btn>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {d.scamReportsToReview.length > 0 && (
        <section>
          <SectionHeader title="Scam reports to review" />
          <ul className="stagger mt-6 space-y-3">
            {d.scamReportsToReview.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-ink bg-white p-4">
                <span>
                  <Tag tone="dark">{r.verdict}</Tag> {r.textPreview}
                </span>
                <span className="flex gap-2">
                  <Btn size="sm" onClick={() => run("c" + r.id, () => api(`/scam-reports/${r.id}/review`, { body: { outcome: "confirmed_scam" } }), done("Confirmed as scam"))}>
                    Scam
                  </Btn>
                  <Btn size="sm" variant="secondary" onClick={() => run("n" + r.id, () => api(`/scam-reports/${r.id}/review`, { body: { outcome: "false_alarm" } }), done("Marked false alarm"))}>
                    False alarm
                  </Btn>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
