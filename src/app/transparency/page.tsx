"use client";

import * as React from "react";
import { SiteHeader, SiteFooter } from "@/components/site/header";
import { SectionHeader, Stat, Spinner, Panel, Bilingual } from "@/components/brut/kit";
import { LiveNumbers } from "@/components/site/live-numbers";
import { api } from "@/lib/api";

type T = {
  generatedAt: string;
  decisions: number;
  shareSentToHumans: number;
  shareAskedForProof: number;
  casesByStatus: Record<string, number>;
  paymentsReleased: number;
  amountReleasedPKR: number;
  medianHoursApplicationToPayment: number | null;
  scam: { flagged: number; confirmedScam: number; falseAlarms: number; awaitingReview: number; falseAlarmRate: number };
  genuineNoticesVerified: number;
};
type HS = { hardStops: { id: string; code: string; title: { en: string; ur: string }; why: string }[]; rule: string };

export default function TransparencyPage() {
  const [t, setT] = React.useState<T | null>(null);
  const [hs, setHs] = React.useState<HS | null>(null);
  React.useEffect(() => {
    api<T>("/transparency", { anonymous: true }).then(setT, () => {});
    api<HS>("/hard-stops", { anonymous: true }).then(setHs, () => {});
  }, []);
  return (
    <>
      <SiteHeader />
      <main className="container-page space-y-24 pb-24">
        <div className="pt-6">
          <h1 className="text-h1 max-w-[18ch]">
            Every number, <span className="marker">including the bad ones.</span>
          </h1>
          <p className="mt-5 max-w-[38rem] text-lead">This page is public and needs no sign-in. It counts what the prototype actually did. No names, no ID numbers.</p>
        </div>

        <section>
          <SectionHeader title="Right now">{t ? `Updated ${new Date(t.generatedAt).toLocaleString("en-GB")}` : "Loading the live counts"}</SectionHeader>
          {t ? (
            <div className="stagger mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <Panel><Stat value={t.decisions} label="decisions made" /></Panel>
              <Panel><Stat value={t.paymentsReleased} label={`payments released (Rs ${t.amountReleasedPKR.toLocaleString("en-PK")})`} /></Panel>
              <Panel><Stat value={t.scam.confirmedScam} label="scam messages confirmed" /></Panel>
              <Panel><Stat value={t.genuineNoticesVerified} label="genuine notices verified" /></Panel>
            </div>
          ) : (
            <Spinner />
          )}
          <LiveNumbers />
        </section>

        <section>
          <SectionHeader title="The 12 hard stops">{hs?.rule ?? "Any one of these sends a case to a person, whatever the score."}</SectionHeader>
          <ul className="stagger mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {hs?.hardStops.map((h) => (
              <li key={h.id} className="rounded-[28px] border border-ink bg-white p-6 shadow-hard">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-full bg-ink font-mono text-lime">{h.id}</span>
                  <span className="font-mono text-[13px] uppercase tracking-wide text-muted-ink">{h.code}</span>
                </div>
                <div className="mt-4">
                  <Bilingual text={{ en: h.title.en, ur: h.title.ur }} speakable={false} />
                </div>
                <p className="mt-3 text-[15px] text-muted-ink">{h.why}</p>
              </li>
            )) ?? <Spinner />}
          </ul>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
