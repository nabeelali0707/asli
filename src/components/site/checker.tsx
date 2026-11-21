"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, X, Minus, Info } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Btn, Stamp, Bilingual, Tag } from "@/components/brut/kit";
import { cn } from "@/lib/utils";

type CheckRow = { name: string; result: "pass" | "fail" | "skip" | "info"; detail: string };
type Outcome = { verdict: string; spoken: { en: string; ur: string; audioKey: string }; checks: CheckRow[]; reportId: string | null };

const SAMPLES = [
  { label: "Fee scam (Roman Urdu)", text: "BISP: Mubarak ho! Aap ki Rs. 25,000 relief payment approve ho gayi hai. Release ke liye Rs 500 processing fee 03451234567 par jama karwayen.", sender: "03451234567" },
  { label: "OTP scam (Urdu)", text: "احساس پروگرام: آپ کی رقم 12000 روپے منظور۔ تصدیق کے لیے اپنا پن کوڈ بھیجیں۔", sender: "03334445556" },
  { label: "Bank OTP (harmless)", text: "Your OTP for logging in to your bank app is 482913. Do not share it.", sender: "BANK" },
];

const CHECK_LABEL: Record<string, string> = {
  signature: "Digital signature",
  expiry: "Still valid",
  beneficiary: "Addressed to this person",
  ledger: "Payment exists in the ledger",
  code: "Spoken code",
  classifier: "Wording check",
  fee_or_code_request: "Asks for a fee, OTP or PIN",
  notice_record: "Notice on record",
  revocation: "Not withdrawn",
  scope: "Whose message",
  advice: "What to do",
};

function RowIcon({ r }: { r: CheckRow["result"] }) {
  const map = { pass: <Check className="size-4" />, fail: <X className="size-4" />, skip: <Minus className="size-4" />, info: <Info className="size-4" /> };
  return <span className={cn("grid size-7 shrink-0 place-items-center rounded-full border border-ink", r === "pass" ? "bg-lime" : r === "fail" ? "bg-ink text-white" : "bg-white")}>{map[r]}</span>;
}

export function Checker({ compact = false, about = "me" as "me" | "someone_else", initialToken }: { compact?: boolean; about?: "me" | "someone_else"; initialToken?: string }) {
  const [text, setText] = React.useState("");
  const [sender, setSender] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [out, setOut] = React.useState<Outcome | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const id = React.useId();

  async function run(body: Record<string, unknown>) {
    setLoading(true);
    setErr(null);
    try {
      const r = await api<Outcome>("/verify", { body: { ...body, about }, anonymous: false });
      setOut(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not check right now.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (initialToken) void run({ token: initialToken });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void run({ text, sender: sender || undefined });
        }}
        className="space-y-3"
      >
        <label htmlFor={`${id}-msg`} className="block font-medium">
          Paste the message you received
        </label>
        <textarea
          id={`${id}-msg`}
          className="field min-h-[112px] resize-y"
          placeholder="e.g. “Your Rs 25,000 relief is approved. Send Rs 500 fee to release it.”"
          value={text}
          onChange={(e) => setText(e.target.value)}
          dir="auto"
        />
        {!compact && (
          <div>
            <label htmlFor={`${id}-sender`} className="mb-2 block text-[15px] text-muted-ink">
              Who sent it? (number or name, optional)
            </label>
            <input id={`${id}-sender`} className="field" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="03451234567" inputMode="tel" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Btn type="submit" loading={loading} disabled={!text.trim()}>
            Check this message
          </Btn>
          <span className="text-[15px] text-muted-ink">or try:</span>
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => {
                setText(s.text);
                setSender(s.sender);
                void run({ text: s.text, sender: s.sender });
              }}
              className="rounded-full border border-ink bg-white px-3 py-1.5 text-[14px] transition-colors hover:bg-lime"
            >
              {s.label}
            </button>
          ))}
        </div>
      </form>

      {err && (
        <p role="alert" className="mt-4 rounded-[14px] border border-ink bg-mist px-4 py-3">
          {err}
        </p>
      )}

      <AnimatePresence initial={false}>
        {out && (
          <motion.div
            key={out.reportId ?? out.verdict + out.spoken.en}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", bounce: 0, visualDuration: 0.35 }}
            className="mt-6 grid gap-6 rounded-[28px] border border-ink bg-white p-6 shadow-hard sm:grid-cols-[auto_1fr] sm:p-8"
          >
            <div className="flex justify-center sm:block">
              <Stamp verdict={out.verdict} />
            </div>
            <div className="space-y-5">
              <Bilingual text={out.spoken} />
              {!compact && out.checks.length > 0 && (
                <ul className="space-y-2.5 border-t border-ink/20 pt-4">
                  {out.checks.map((c, i) => (
                    <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.06 }} className="flex gap-3 text-[15px]">
                      <RowIcon r={c.result} />
                      <span>
                        <span className="font-medium">{CHECK_LABEL[c.name] ?? c.name}</span>
                        <span className="text-muted-ink"> — {c.detail}</span>
                      </span>
                    </motion.li>
                  ))}
                </ul>
              )}
              {out.reportId && <Tag tone="mist">Reported to the scam map</Tag>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
