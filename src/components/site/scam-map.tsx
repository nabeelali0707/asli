"use client";

import * as React from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { Spinner, Tag, Empty } from "@/components/brut/kit";

type ScamMap = {
  days: number;
  districts: { district: string; total: number; byCategory: Record<string, number> }[];
  topSenders: { sender: string; n: number }[];
  spikes: { district: string; last24h: number; dailyAvgPrior7d: number }[];
};

const CAT: Record<string, string> = { fee_request: "Fee request", relief_scam: "Fake relief", phishing_link: "Bad link", unrelated: "Other", genuine_notice: "Genuine" };

export function ScamMapView({ data }: { data: ScamMap }) {
  const max = Math.max(1, ...data.districts.map((d) => d.total));
  const spiking = new Set(data.spikes.map((s) => s.district));
  if (!data.districts.length) return <Empty title="No scam reports yet">Reports appear here as people check messages.</Empty>;
  return (
    <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
      <ul className="space-y-3">
        {data.districts.map((d, i) => (
          <li key={d.district} className="grid grid-cols-[8rem_1fr_auto] items-center gap-4">
            <span className="font-medium">{d.district}</span>
            <div className="h-9 overflow-hidden rounded-[10px] border border-ink bg-white">
              <motion.div
                className={spiking.has(d.district) ? "h-full bg-ink" : "h-full bg-lime"}
                style={{ originX: 0 }}
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: d.total / max }}
                viewport={{ once: true }}
                transition={{ type: "spring", bounce: 0, visualDuration: 0.6, delay: i * 0.05 }}
              />
            </div>
            <span className="flex items-center gap-2 font-mono">
              {d.total}
              {spiking.has(d.district) && <Tag tone="dark">spike</Tag>}
            </span>
            <span className="col-start-2 -mt-1 text-[13px] text-muted-ink">
              {Object.entries(d.byCategory)
                .map(([k, n]) => `${CAT[k] ?? k} ${n}`)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <div className="rounded-[28px] border border-ink bg-white p-6 shadow-hard">
        <h3 className="text-lg font-medium">Numbers sending the most scams</h3>
        <ol className="mt-4 space-y-2">
          {data.topSenders.slice(0, 6).map((s) => (
            <li key={s.sender} className="flex items-center justify-between border-b border-ink/10 pb-2 font-mono text-[15px] last:border-0">
              <span>{s.sender}</span>
              <span className="rounded-[7px] bg-mist px-2">{s.n}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function ScamMapPublic() {
  const [data, setData] = React.useState<ScamMap | null>(null);
  React.useEffect(() => {
    api<ScamMap>("/scam-map/public", { anonymous: true }).then(setData, () => setData({ days: 30, districts: [], topSenders: [], spikes: [] }));
  }, []);
  return <div className="mt-10">{data ? <ScamMapView data={data} /> : <Spinner label="Loading reports" />}</div>;
}
