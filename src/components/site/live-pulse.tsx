"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { CountUp } from "@/components/brut/kit";

type T = { decisions: number; messagesChecked: number; peopleServed: number; paymentsReleased: number; scam: { flagged: number; confirmedScam: number } };
type Map = { districts: { district: string; total: number }[]; spikes: { district: string; last24h: number }[] };

/** Live strip under the hero: real counts from the database, refreshed every 30 seconds. */
export function LivePulse() {
  const [t, setT] = React.useState<T | null>(null);
  const [m, setM] = React.useState<Map | null>(null);
  const [at, setAt] = React.useState<Date | null>(null);

  React.useEffect(() => {
    let live = true;
    const load = () =>
      Promise.all([api<T>("/transparency", { anonymous: true }), api<Map>("/scam-map/public", { anonymous: true })]).then(
        ([a, b]) => live && (setT(a), setM(b), setAt(new Date())),
        () => {},
      );
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  if (!t) return <div className="container-page"><div className="h-[74px] animate-pulse rounded-[22px] bg-mist" aria-hidden /></div>;
  const top = m?.districts.slice(0, 3) ?? [];
  const spike = m?.spikes[0];
  const stats: [number, string][] = [
    [t.messagesChecked, "messages checked"],
    [t.scam.confirmedScam, "scams confirmed"],
    [t.decisions, "decisions made"],
    [t.peopleServed, "people on the system"],
  ];
  return (
    <section className="container-page" aria-label="Live numbers">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-[22px] border border-ink bg-white px-6 py-4 shadow-hard">
        <span className="flex items-center gap-2 text-[14px] font-medium">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-lime opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full border border-ink bg-lime" />
          </span>
          Live {at && <span className="font-normal text-muted-ink">· updated {at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
        </span>
        <ul className="flex flex-wrap gap-x-8 gap-y-2">
          {stats.map(([n, l]) => (
            <li key={l} className="flex items-baseline gap-2">
              <span className="font-mono text-xl"><CountUp to={n} /></span>
              <span className="text-[14px] text-muted-ink">{l}</span>
            </li>
          ))}
        </ul>
        {top.length > 0 && (
          <p className="text-[14px] text-muted-ink">
            Most reports: {top.map((d) => `${d.district} ${d.total}`).join(" · ")}
            {spike && <span className="ms-2 rounded-[7px] bg-ink px-2 py-0.5 font-mono text-[12px] text-white">spike: {spike.district}</span>}
          </p>
        )}
      </div>
    </section>
  );
}
