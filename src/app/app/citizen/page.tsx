"use client";

import * as React from "react";
import { toast } from "sonner";
import { Mic, Square } from "lucide-react";
import { api, newKey } from "@/lib/api";
import { useApi, useAction, fmtWhen } from "@/lib/hooks";
import { Btn, Card, CardTitle, Bilingual, LaneChip, Spinner, Empty, Tag, SectionHeader } from "@/components/brut/kit";
import { DocUpload } from "@/components/app/doc-upload";
import { CaseActions } from "@/components/app/case-actions";
import { OfflineApply } from "@/components/app/offline-apply";

type Bi = { en: string; ur: string };
type MyCase = { id: string; ref: string; status: string; statusWords: Bi; lane: string | null; proofRequested: unknown; proofDeadline: string | null; createdAt: string; latestReason: Bi | null; counterfactuals: { en: string; ur: string }[] };
type Notice = { id: string; title: string; body: Bi; status: string; createdAt: string };
type Intake = { transcript: string; fields: Record<string, unknown>; confirm: Bi; askAgainFor: string[]; draftCaseId: string | null };

function VoiceApply({ onDone }: { onDone: () => void }) {
  const [text, setText] = React.useState("");
  const [listening, setListening] = React.useState(false);
  const [heard, setHeard] = React.useState<Intake | null>(null);
  const { busy, run } = useAction();
  const recRef = React.useRef<{ stop: () => void } | null>(null);
  const supported = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  function listen() {
    const W = window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const R = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!R) return;
    const rec = new R();
    rec.lang = "ur-PK";
    rec.interimResults = false;
    rec.onresult = (e: any) => setText((t) => (t + " " + e.results[0][0].transcript).trim());
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <div className="space-y-4">
      <label htmlFor="say" className="block font-medium">
        Tell us in your own words <span lang="ur" className="urdu text-muted-ink">— اپنی بات بولیں</span>
      </label>
      <textarea id="say" className="field min-h-[110px]" dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder="Mera naam … hai, main bewa hoon, ghar mein 5 log hain, aamdani …" />
      <div className="flex flex-wrap gap-3">
        {supported && (
          <Btn type="button" variant="lime" onClick={() => (listening ? recRef.current?.stop() : listen())} aria-pressed={listening}>
            {listening ? <Square className="size-4" /> : <Mic className="size-4" />} {listening ? "Stop" : "Speak"}
          </Btn>
        )}
        <Btn
          type="button"
          disabled={!text.trim()}
          loading={busy === "intake"}
          onClick={() => run("intake", () => api<Intake>("/voice/intake", { body: { transcript: text, language: "ur", createDraft: true, clientRef: newKey() } }), setHeard)}
        >
          Understand this
        </Btn>
      </div>
      {heard && (
        <div className="rounded-[18px] border border-ink bg-white p-5">
          <Bilingual text={heard.confirm} />
          {heard.askAgainFor.length > 0 && <p className="mt-3 text-[15px]">Still unclear: {heard.askAgainFor.join(", ")}. Say these again or tell your helper.</p>}
          {heard.draftCaseId && <div className="mt-4"><DocUpload caseId={heard.draftCaseId} /></div>}
          {heard.draftCaseId && (
            <Btn
              className="mt-4"
              loading={busy === "submit"}
              onClick={() =>
                run("submit", () => api(`/cases/${heard.draftCaseId}/submit`, { method: "POST", body: {} }), () => {
                  toast.success("Sent. You will hear the answer here.");
                  setHeard(null);
                  setText("");
                  onDone();
                })
              }
            >
              Yes, that is right — send it
            </Btn>
          )}
        </div>
      )}
    </div>
  );
}

function ReceiptPrompt({ payoutId, onDone }: { payoutId: string; onDone: () => void }) {
  const q = useApi<{ question: Bi; expectedAmount: number }>(`/payouts/${payoutId}/receipt-prompt`);
  const { busy, run } = useAction();
  if (!q.data) return null;
  const send = (status: "received_full" | "received_less" | "not_received") =>
    run(status, () => api(`/payouts/${payoutId}/receipt`, { body: { status, via: "app", amount: status === "received_full" ? q.data!.expectedAmount : undefined } }), () => {
      toast.success(status === "received_full" ? "Thank you. Marked as received." : "We opened a complaint and told an officer.");
      onDone();
    });
  return (
    <div className="mt-5 rounded-[18px] border border-ink bg-lime p-5">
      <Bilingual text={q.data.question} />
      <div className="mt-4 flex flex-wrap gap-3">
        <Btn onClick={() => send("received_full")} loading={busy === "received_full"}>Yes, full amount</Btn>
        <Btn variant="secondary" onClick={() => send("received_less")} loading={busy === "received_less"}>Less than that</Btn>
        <Btn variant="secondary" onClick={() => send("not_received")} loading={busy === "not_received"}>Nothing arrived</Btn>
      </div>
    </div>
  );
}

export default function CitizenHome() {
  const cases = useApi<{ cases: MyCase[] }>("/cases/mine");
  const notes = useApi<{ notifications: Notice[] }>("/notifications");
  const [open, setOpen] = React.useState<string | null>(null);
  const detail = useApi<{ payout: { id: string; status: string } | null }>(open ? `/cases/${open}` : null);

  return (
    <div className="space-y-16">
      <section>
        <h1 className="text-h1">
          Your <span className="marker">help</span>
        </h1>
        <p className="mt-3 text-lead text-muted-ink">Every answer here can be read aloud. Tap Listen.</p>
        <div className="stagger mt-8 space-y-6">
          {cases.loading && <Spinner />}
          {cases.data?.cases.length === 0 && <Empty title="No claim yet">Tell us below and we will start one.</Empty>}
          {cases.data?.cases.map((c) => (
            <Card key={c.id} tone={c.lane === "human" ? "dark" : "light"} reveal={false} className="p-6 sm:p-10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle tone={c.lane === "human" ? "dark" : "light"}>Case {c.ref}</CardTitle>
                <div className="flex items-center gap-2">
                  <LaneChip lane={c.lane} />
                  <Tag tone="mist">{c.statusWords.en}</Tag>
                </div>
              </div>
              {c.latestReason && <Bilingual className="mt-6" text={c.latestReason} tone={c.lane === "human" ? "dark" : "light"} />}
              {c.counterfactuals.length > 0 && (
                <ul className="mt-4 list-disc space-y-1 ps-5 text-[15px]">
                  {c.counterfactuals.map((x, i) => <li key={i}>{x.en}</li>)}
                </ul>
              )}
              <CaseActions c={c} onDone={cases.reload} />
              <p className="mt-5 text-[13px] opacity-70">Started {fmtWhen(c.createdAt)}{c.proofDeadline ? ` · send proof by ${fmtWhen(c.proofDeadline)}` : ""}</p>
              {c.status === "paid" && (
                <>
                  {open !== c.id ? (
                    <Btn className="mt-4" variant="secondary" onClick={() => setOpen(c.id)}>Did the money reach you?</Btn>
                  ) : detail.data?.payout ? (
                    <ReceiptPrompt payoutId={detail.data.payout.id} onDone={() => { setOpen(null); cases.reload(); }} />
                  ) : <Spinner />}
                </>
              )}
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Apply or add details">Speak or type. We read back what we understood before anything is sent.</SectionHeader>
        <div className="mt-8 rounded-[28px] border border-ink bg-mist p-6 shadow-hard sm:p-8">
          <VoiceApply onDone={cases.reload} />
        </div>
        <details className="mt-6 rounded-[28px] border border-ink bg-white p-6 shadow-hard">
          <summary className="cursor-pointer font-medium">No signal, or prefer a form?</summary>
          <div className="mt-5"><OfflineApply onSent={cases.reload} /></div>
        </details>
      </section>

      <section>
        <SectionHeader title="Messages we sent you">Real Asli messages carry a code. Use “Check a message” to test any other.</SectionHeader>
        <ul className="stagger mt-8 space-y-4">
          {notes.data?.notifications.map((n) => (
            <li key={n.id} className="rounded-[22px] border border-ink bg-white p-5">
              <Bilingual text={n.body} />
              <p className="mt-3 text-[13px] text-muted-ink">{fmtWhen(n.createdAt)}</p>
            </li>
          ))}
          {notes.data?.notifications.length === 0 && <Empty title="Nothing yet" />}
        </ul>
      </section>
    </div>
  );
}
