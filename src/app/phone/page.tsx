"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Phone, PhoneOff, Delete } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site/header";
import { Btn, SpeakButton, UrduText, Tag } from "@/components/brut/kit";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Bi = { en: string; ur: string; audioKey?: string | null };
type Step = { sessionId: string; state: string; prompt: Bi; expect?: string; ended: boolean };
type Line = { who: "asli" | "you"; text?: Bi; digits?: string };

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

/** A simulated phone for people with no smartphone: missed call, Asli rings back, press keys. Same API a real telephony gateway would call. */
export default function PhonePage() {
  const [number, setNumber] = React.useState("03001112233");
  const [call, setCall] = React.useState<Step | null>(null);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [typed, setTyped] = React.useState("");
  const [phase, setPhase] = React.useState<"idle" | "ringing" | "live" | "ended">("idle");
  const [err, setErr] = React.useState<string | null>(null);
  const log = React.useRef<HTMLOListElement>(null);

  React.useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  async function missedCall() {
    setErr(null);
    setLines([]);
    setPhase("ringing");
    try {
      const r = await api<Step>("/ivr/calls", { body: { phone: number }, anonymous: true });
      await new Promise((res) => setTimeout(res, 1600)); // the callback "rings"
      setCall(r);
      setLines([{ who: "asli", text: r.prompt }]);
      setPhase(r.ended ? "ended" : "live");
    } catch (e) {
      setPhase("idle");
      setErr(e instanceof ApiError ? e.message : "Could not start the call.");
    }
  }

  async function press(d: string) {
    if (!call || phase !== "live") return;
    // Menus take one key at a time; entering a code collects digits until # (or Send).
    if (call.expect === "digit") return void send(d);
    if (d === "#") return void send(typed || "#");
    setTyped((t) => (t + d).slice(-8));
  }

  async function send(digits: string) {
    if (!call) return;
    setTyped("");
    setLines((l) => [...l, { who: "you", digits }]);
    try {
      const r = await api<Step>(`/ivr/calls/${call.sessionId}/input`, { body: { digits }, anonymous: true });
      setCall({ ...call, ...r });
      setLines((l) => [...l, { who: "asli", text: r.prompt }]);
      if (r.ended) setPhase("ended");
    } catch (e) {
      setLines((l) => [...l, { who: "asli", text: { en: e instanceof ApiError ? e.message : "Something went wrong.", ur: "کچھ غلط ہو گیا۔" } }]);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="container-page pb-24">
        <div className="grid gap-12 pt-4 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <h1 className="text-h1">
              No smartphone? <span className="marker">Use a phone call.</span>
            </h1>
            <p className="max-w-[36rem] text-lead">Give a missed call. Asli calls back and speaks in Urdu. Press 1 for your case status, 2 to check a message code, 3 to talk to a person, 9 if someone is changing your account.</p>
            <ul className="space-y-2 text-[15px] text-muted-ink">
              <li>This is a simulation. A real phone line would call the same API.</li>
              <li>Everything said here is also available as plain text and audio.</li>
            </ul>
            <label className="block max-w-sm space-y-1.5">
              <span className="text-[15px]">Phone number (demo: 03001112233 is Fatima)</span>
              <input className="field font-mono" inputMode="tel" value={number} onChange={(e) => setNumber(e.target.value)} disabled={phase === "ringing" || phase === "live"} />
            </label>
            {err && <p role="alert" className="max-w-sm rounded-[14px] border border-ink bg-mist px-4 py-3">{err}</p>}
          </div>

          <div className="mx-auto w-full max-w-[380px] rounded-[44px] border-2 border-ink bg-ink p-5 text-white shadow-hard-lg on-dark">
            <div className="mb-4 flex items-center justify-between px-2 text-[13px] text-white/70">
              <span>Asli line</span>
              <Tag tone="white">{phase === "idle" ? "ready" : phase}</Tag>
            </div>
            <ol ref={log} className="mb-4 h-[300px] space-y-3 overflow-y-auto rounded-[24px] bg-white/10 p-4" aria-live="polite" aria-label="Call transcript">
              {phase === "idle" && <li className="text-white/70">Press the green button to give a missed call.</li>}
              {phase === "ringing" && (
                <li className="flex items-center gap-2 text-white/90">
                  <motion.span animate={{ rotate: [-12, 12, -12] }} transition={{ repeat: Infinity, duration: 0.5 }}><Phone className="size-5" aria-hidden /></motion.span>
                  Asli is calling you back…
                </li>
              )}
              <AnimatePresence initial={false}>
                {lines.map((l, i) => (
                  <motion.li key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("max-w-[92%] rounded-[16px] px-3 py-2 text-[15px]", l.who === "you" ? "ms-auto bg-lime text-black" : "bg-white text-black")}>
                    {l.who === "you" ? (
                      <span className="font-mono">pressed {l.digits}</span>
                    ) : (
                      <span className="block space-y-1">
                        <UrduText className="text-[1rem]">{l.text!.ur}</UrduText>
                        <span className="block text-muted-ink">{l.text!.en}</span>
                        <SpeakButton text={{ en: l.text!.en, ur: l.text!.ur }} label="Hear" className="!py-1 text-[13px]" />
                      </span>
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Keypad">
              {KEYS.map((k) => (
                <button key={k} type="button" onClick={() => press(k)} disabled={phase !== "live"} className="rounded-[16px] bg-white/10 py-3 font-mono text-xl transition-colors hover:bg-lime hover:text-black disabled:opacity-40">
                  {k}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="flex-1 rounded-[14px] bg-white/10 px-3 py-2 font-mono text-lg tracking-widest">{typed || " "}</span>
              <button type="button" aria-label="Delete last digit" onClick={() => setTyped((t) => t.slice(0, -1))} disabled={phase !== "live" || !typed} className="rounded-[14px] bg-white/10 p-3 disabled:opacity-40"><Delete className="size-5" /></button>
              <button type="button" onClick={() => typed && send(typed)} disabled={phase !== "live" || !typed} className="rounded-[14px] bg-lime px-4 py-2.5 font-medium text-black disabled:opacity-40">Send</button>
            </div>
            <div className="mt-4 flex justify-center">
              {phase === "live" || phase === "ringing" ? (
                <Btn variant="inverse" onClick={() => { setPhase("ended"); setCall(null); }}>
                  <PhoneOff className="size-4" aria-hidden /> Hang up
                </Btn>
              ) : (
                <Btn variant="lime" onClick={missedCall}>
                  <Phone className="size-4" aria-hidden /> {phase === "ended" ? "Call again" : "Give a missed call"}
                </Btn>
              )}
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
