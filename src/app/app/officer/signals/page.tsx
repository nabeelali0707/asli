"use client";

import { useApi } from "@/lib/hooks";
import { Spinner, Tag, SectionHeader, Empty } from "@/components/brut/kit";
import { ScamMapView } from "@/components/site/scam-map";

type An = { anomalies: { type: string; severity: string; detail: string }[] };

export default function Signals() {
  const a = useApi<An>("/anomalies");
  const m = useApi<React.ComponentProps<typeof ScamMapView>["data"]>("/scam-map");
  return (
    <div className="space-y-12">
      <h1 className="text-h1">
        Scams &amp; <span className="marker">anomalies</span>
      </h1>
      <section>
        <SectionHeader title="Needs a look">Spikes and patterns the system noticed on its own.</SectionHeader>
        <ul className="mt-6 space-y-3">
          {a.data?.anomalies.length === 0 && <Empty title="Nothing unusual" />}
          {a.data?.anomalies.map((x, i) => (
            <li key={i} className="flex flex-wrap items-center gap-3 rounded-[18px] border border-ink bg-white p-4">
              <Tag tone={x.severity === "high" ? "dark" : "mist"}>{x.severity}</Tag>
              <span className="font-mono text-[13px] uppercase">{x.type}</span>
              <span>{x.detail}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <SectionHeader title="Scam map">Full sender numbers, visible to staff only.</SectionHeader>
        <div className="mt-8">{m.data ? <ScamMapView data={m.data} /> : <Spinner />}</div>
      </section>
    </div>
  );
}
