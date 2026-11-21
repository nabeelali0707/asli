"use client";

import { toast } from "sonner";
import { api } from "@/lib/api";
import { useApi, useAction } from "@/lib/hooks";
import { Btn, Panel, Tag, Spinner } from "@/components/brut/kit";

type Svc = { latencyMs: number; failRate: number; timeoutRate: number; down: boolean };
type Chaos = { services: Record<string, Svc>; breakers: Record<string, { state: string; failures: number; lastError: string | null }> };
const NAMES: Record<string, string> = { nadra: "Identity registry (mock)", income: "Income registry (mock)", raast: "Instant payments (mock)" };

export default function ChaosPanel() {
  const q = useApi<Chaos>("/chaos");
  const { busy, run } = useAction();
  const set = (id: string, b: Partial<Svc>) => run(id, () => api(`/chaos/${id}`, { body: b }), () => q.reload());
  if (!q.data) return <Spinner />;
  return (
    <div className="space-y-8">
      <h1 className="text-h1">
        Chaos <span className="marker">panel</span>
      </h1>
      <p className="max-w-[42rem] text-lead text-muted-ink">Break the mock registries on purpose. A circuit breaker should open and cases should go to a person, never get approved on missing data.</p>
      <div className="stagger grid gap-6 lg:grid-cols-3">
        {Object.entries(q.data.services).map(([id, s]) => {
          const b = q.data!.breakers[id];
          return (
            <Panel key={id} className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-medium">{NAMES[id] ?? id}</h2>
                <Tag tone={b?.state === "closed" ? "lime" : "dark"}>breaker {b?.state}</Tag>
              </div>
              <label className="block text-[15px]">
                Latency {s.latencyMs} ms
                <input type="range" min={0} max={3000} step={100} value={s.latencyMs} onChange={(e) => set(id, { latencyMs: +e.target.value })} className="mt-2 w-full accent-ink" />
              </label>
              <label className="block text-[15px]">
                Failure rate {Math.round(s.failRate * 100)}%
                <input type="range" min={0} max={1} step={0.1} value={s.failRate} onChange={(e) => set(id, { failRate: +e.target.value })} className="mt-2 w-full accent-ink" />
              </label>
              <Btn variant={s.down ? "primary" : "secondary"} size="sm" loading={busy === id} onClick={() => set(id, { down: !s.down })}>
                {s.down ? "Bring back up" : "Take down"}
              </Btn>
              {b?.lastError && <p className="font-mono text-[12px] text-muted-ink">{b.lastError}</p>}
            </Panel>
          );
        })}
      </div>
      <Btn
        variant="secondary"
        loading={busy === "reset"}
        onClick={() =>
          run("reset", () => api("/chaos/reset", { method: "POST", body: {} }), () => {
            toast.success("All faults cleared");
            q.reload();
          })
        }
      >
        Reset everything
      </Btn>
    </div>
  );
}
