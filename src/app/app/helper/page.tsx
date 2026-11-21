"use client";

import * as React from "react";
import { toast } from "sonner";
import { api, session, newKey } from "@/lib/api";
import { useApi, useAction, fmtWhen } from "@/lib/hooks";
import { Btn, Card, CardTitle, Bilingual, LaneChip, Spinner, Empty, Tag, SectionHeader } from "@/components/brut/kit";

type Bi = { en: string; ur: string };
type Citizen = { id: string; fullName: string; district: string; cnic: string; view: string };
type Family = { citizen: Citizen; consentId: string; expiresAt: string };
type Case = { id: string; ref: string; statusWords: Bi; lane: string | null; latestReason: Bi | null; createdAt: string };
type Intake = { confirm: Bi; draftCaseId: string | null; askAgainFor: string[] };

function FamilyWork({ family, onExit }: { family: { citizenId: string; name: string }; onExit: () => void }) {
  const cases = useApi<{ cases: Case[] }>("/cases/mine", { asFamily: true });
  const [text, setText] = React.useState("");
  const [heard, setHeard] = React.useState<Intake | null>(null);
  const { busy, run } = useAction();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-ink bg-lime p-5">
        <div>
          <p className="text-[13px] uppercase tracking-wide">Acting for</p>
          <p className="text-xl font-medium">{family.name}</p>
        </div>
        <Btn variant="secondary" onClick={onExit}>Switch family</Btn>
      </div>
      <div className="space-y-4">
        {cases.data?.cases.length === 0 && <Empty title="No case for this family yet" />}
        {cases.data?.cases.map((c) => (
          <Card key={c.id} reveal={false} className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Case {c.ref}</CardTitle>
              <div className="flex gap-2"><LaneChip lane={c.lane} /><Tag>{c.statusWords.en}</Tag></div>
            </div>
            {c.latestReason && <Bilingual className="mt-5" text={c.latestReason} />}
          </Card>
        ))}
      </div>
      <div className="rounded-[28px] border border-ink bg-mist p-6 shadow-hard">
        <label htmlFor="fam-say" className="mb-2 block font-medium">What the family says</label>
        <textarea id="fam-say" className="field min-h-[100px]" dir="auto" value={text} onChange={(e) => setText(e.target.value)} />
        <Btn
          className="mt-3"
          disabled={!text.trim()}
          loading={busy === "intake"}
          onClick={() => run("intake", () => api<Intake>("/voice/intake", { asFamily: true, body: { transcript: text, createDraft: true, clientRef: newKey() } }), setHeard)}
        >
          Understand this
        </Btn>
        {heard && (
          <div className="mt-5 rounded-[18px] border border-ink bg-white p-5">
            <Bilingual text={heard.confirm} />
            {heard.draftCaseId && (
              <Btn className="mt-4" loading={busy === "submit"} onClick={() => run("submit", () => api(`/cases/${heard.draftCaseId}/submit`, { asFamily: true, method: "POST", body: {} }), () => { toast.success("Sent for this family."); setHeard(null); setText(""); cases.reload(); })}>
                The family confirms — send
              </Btn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function HelperHome() {
  const fams = useApi<{ families: Family[] }>("/helper/families");
  const [active, setActive] = React.useState<{ citizenId: string; name: string } | null>(null);
  const [pinFor, setPinFor] = React.useState<Family | null>(null);
  const [pin, setPin] = React.useState("");
  const { busy, run } = useAction();

  React.useEffect(() => {
    const f = session.family();
    if (f) setActive({ citizenId: f.citizenId, name: f.name });
  }, []);

  if (active) return <FamilyWork family={active} onExit={() => { session.setFamily(null); setActive(null); fams.reload(); }} />;

  return (
    <div className="space-y-8">
      <h1 className="text-h1">Your <span className="marker">families</span></h1>
      <p className="max-w-[40rem] text-lead text-muted-ink">Names are hidden until the family enters its own PIN. Demo PIN for every family: <span className="font-mono">4321</span>.</p>
      {fams.loading && <Spinner />}
      <ul className="grid gap-5 md:grid-cols-2">
        {fams.data?.families.map((f) => (
          <li key={f.consentId} className="rounded-[28px] border border-ink bg-white p-6 shadow-hard">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xl font-medium">{f.citizen.fullName}</p>
                <p className="text-muted-ink">{f.citizen.district} · <span className="font-mono">{f.citizen.cnic}</span></p>
              </div>
              <Tag tone="mist">until {fmtWhen(f.expiresAt)}</Tag>
            </div>
            {pinFor?.consentId === f.consentId ? (
              <form
                className="mt-5 flex gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  run("switch", () => api<{ familyToken: string; expiresAt: string; citizen: Citizen }>("/helper/switch", { body: { citizenId: f.citizen.id, pin } }), (r) => {
                    session.setFamily({ token: r.familyToken, expiresAt: r.expiresAt, citizenId: r.citizen.id, name: r.citizen.fullName });
                    setActive({ citizenId: r.citizen.id, name: r.citizen.fullName });
                  });
                }}
              >
                <label className="sr-only" htmlFor={`pin-${f.consentId}`}>Family PIN</label>
                <input id={`pin-${f.consentId}`} autoFocus className="field font-mono tracking-[0.4em]" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
                <Btn type="submit" loading={busy === "switch"} disabled={pin.length < 4}>Open</Btn>
              </form>
            ) : (
              <Btn className="mt-5" variant="secondary" onClick={() => { setPinFor(f); setPin(""); }}>Enter family PIN</Btn>
            )}
          </li>
        ))}
      </ul>
      <SectionHeader title="Why a PIN">Each family gave its own permission. Five wrong PINs lock that family for 15 minutes, and withdrawing consent ends your access at once.</SectionHeader>
    </div>
  );
}
