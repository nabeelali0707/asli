"use client";

import * as React from "react";
import { toast } from "sonner";
import { Bot, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useSession, fmtWhen } from "@/lib/hooks";
import { Btn, Panel, Tag } from "@/components/brut/kit";

type AgentRun = { mode: string; steps: { tool: string; ok: boolean; at: string; output: unknown }[]; summary: string };
type Glass = { citizen: { fullName: string; fatherName: string; cnic: string; dob: string; phone: string; payoutAlias: string; district: string }; minutes: number; expiresAt: string; notice: string };

/** Everything an officer can do to a case besides approve/reject: assign, escalate, close, re-decide, run the agent, open full details. */
export function OfficerTools({ caseId, citizenId, assignedTo, status, onDone }: { caseId: string; citizenId: string; assignedTo: string | null; status: string; onDone: () => void }) {
  const s = useSession();
  const me = s?.user.id;
  const { busy, run } = useAction();
  const [mode, setMode] = React.useState<null | "escalate" | "close" | "glass">(null);
  const [text, setText] = React.useState("");
  const [agent, setAgent] = React.useState<AgentRun | null>(null);
  const [glass, setGlass] = React.useState<Glass | null>(null);
  const done = (m: string) => () => {
    toast.success(m);
    setMode(null);
    setText("");
    onDone();
  };
  const min = mode === "glass" ? 10 : 3;

  return (
    <section className="space-y-5" aria-label="Case tools">
      <h2 className="text-h3">
        <span className="marker">Case tools</span>
      </h2>
      <div className="flex flex-wrap gap-3">
        {assignedTo === me ? (
          <Btn variant="secondary" size="sm" loading={busy === "assign"} onClick={() => run("assign", () => api(`/cases/${caseId}/assign`, { body: { officerId: null } }), done("Unassigned"))}>
            Unassign me
          </Btn>
        ) : (
          <Btn variant="secondary" size="sm" loading={busy === "assign"} onClick={() => run("assign", () => api(`/cases/${caseId}/assign`, { body: { officerId: me } }), done("Assigned to you"))}>
            Assign to me
          </Btn>
        )}
        <Btn variant="secondary" size="sm" onClick={() => setMode(mode === "escalate" ? null : "escalate")}>
          Escalate
        </Btn>
        <Btn variant="secondary" size="sm" onClick={() => setMode(mode === "close" ? null : "close")} disabled={status === "closed"}>
          Close case
        </Btn>
        <Btn variant="secondary" size="sm" loading={busy === "redecide"} onClick={() => run("redecide", () => api(`/cases/${caseId}/redecide`, { method: "POST", body: {} }), done("Decision re-run under the current rules"))}>
          Re-run decision
        </Btn>
        <Btn variant="secondary" size="sm" loading={busy === "agent"} onClick={() => run("agent", () => api<AgentRun>(`/cases/${caseId}/agent`, { method: "POST", body: {} }), setAgent)}>
          <Bot className="size-4" aria-hidden /> Run case agent
        </Btn>
        <Btn variant="secondary" size="sm" onClick={() => setMode(mode === "glass" ? null : "glass")}>
          <ShieldAlert className="size-4" aria-hidden /> Open full details
        </Btn>
      </div>

      {mode && (
        <Panel className="space-y-3">
          <label htmlFor="tool-reason" className="block font-medium">
            {mode === "glass" ? "Why do you need the full details? (logged, and the citizen can see it)" : mode === "close" ? "Reason for closing" : "Why are you escalating?"}
          </label>
          <input id="tool-reason" className="field" value={text} onChange={(e) => setText(e.target.value)} />
          <Btn
            disabled={text.trim().length < min}
            loading={busy === mode}
            onClick={() => {
              if (mode === "glass") void run("glass", () => api<Glass>(`/citizens/${citizenId}/break-glass`, { body: { reason: text } }), (g) => { setGlass(g); setMode(null); setText(""); });
              else if (mode === "close") void run("close", () => api(`/cases/${caseId}/close`, { body: { reason: text } }), done("Case closed"));
              else void run("escalate", () => api(`/cases/${caseId}/escalate`, { body: { reason: text } }), done("Escalated"));
            }}
          >
            {mode === "glass" ? "Open (15 minutes)" : "Confirm"}
          </Btn>
          {mode === "glass" && text.trim().length > 0 && text.trim().length < 10 && <p className="text-[13px] text-muted-ink">Give at least 10 characters.</p>}
        </Panel>
      )}

      {glass && (
        <div className="space-y-3 rounded-[28px] border-2 border-ink bg-lime p-6" role="status">
          <p className="flex items-center gap-2 font-medium">
            <ShieldAlert className="size-5" aria-hidden /> Full details open until {fmtWhen(glass.expiresAt)}
          </p>
          <p className="text-[15px]">{glass.notice}</p>
          <dl className="grid gap-x-8 gap-y-1 text-[15px] sm:grid-cols-2">
            {Object.entries({ Name: glass.citizen.fullName, "Father's name": glass.citizen.fatherName, CNIC: glass.citizen.cnic, "Date of birth": glass.citizen.dob, Phone: glass.citizen.phone, Account: glass.citizen.payoutAlias, District: glass.citizen.district }).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="text-muted-ink">{k}</dt>
                <dd className="font-mono">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {agent && (
        <Panel className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="mist">agent · {agent.mode}</Tag>
            <span className="text-[14px] text-muted-ink">Every tool call is logged. It cannot approve or pay.</span>
          </div>
          <ol className="space-y-2">
            {agent.steps.map((st, i) => (
              <li key={i} className="flex items-start gap-3 text-[15px]">
                <Tag tone={st.ok ? "lime" : "dark"}>{st.ok ? "ok" : "blocked"}</Tag>
                <span>
                  <span className="font-mono">{st.tool}</span>
                  <span className="block break-words font-mono text-[12px] text-muted-ink">{JSON.stringify(st.output).slice(0, 160)}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="text-[15px]">{agent.summary}</p>
        </Panel>
      )}
    </section>
  );
}
