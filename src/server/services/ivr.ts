/**
 * Feature-phone line (IVR) — the widow needs no smartphone and no data.
 * Flow: missed call → callback → "press 1 status, 2 check a message, 3 talk to a person".
 * Telephony is simulated: each step returns the prompt (en/ur + audio key) a real IVR would play.
 * Callers are identified by phone number only for READ-ONLY status; nothing is changed by IVR
 * except opening a callback request.
 */
import { desc, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { ivrSessions, citizens, cases, notices, caseNotes } from "../db/schema";
import { newId } from "../lib/ids";
import { t, STATUS_WORDS, type Spoken } from "../lib/i18n";
import { audit } from "../lib/audit";
import { caseRef } from "./notices";
import { codeForSpeech } from "../lib/signing";
import { notFound } from "../lib/errors";

type IvrReply = { sessionId: string; state: string; prompt: Spoken; expect: "digit" | "digits" | "none"; ended: boolean };

function normPhone(p: string) {
  const d = p.replace(/\D/g, "");
  return d.startsWith("92") ? "0" + d.slice(2) : d;
}

export async function ivrStart(db: DB, phone: string): Promise<IvrReply> {
  const id = newId("ivr");
  const p = normPhone(phone);
  const all = await db.select({ id: citizens.id, phone: citizens.phone, tenantId: citizens.tenantId }).from(citizens);
  const match = all.find((c) => c.phone && normPhone(c.phone) === p);
  await db.insert(ivrSessions).values({ id, phone: p, citizenId: match?.id ?? null, state: "menu" });
  await audit(db, { actor: { type: "system", id: "ivr", tenantId: match?.tenantId ?? null, role: "system" }, action: "ivr.call_started", targetType: "citizen", targetId: match?.id, detail: { known: !!match } });
  return { sessionId: id, state: "menu", prompt: t("ivr.welcome"), expect: "digit", ended: false };
}

export async function ivrInput(db: DB, sessionId: string, digits: string): Promise<IvrReply> {
  const [s] = await db.select().from(ivrSessions).where(eq(ivrSessions.id, sessionId));
  if (!s) throw notFound("Call session");
  const set = async (state: string, data: Record<string, unknown> = {}) => db.update(ivrSessions).set({ state, data, updatedAt: new Date() }).where(eq(ivrSessions.id, sessionId));
  const reply = (state: string, prompt: Spoken, expect: IvrReply["expect"], ended = false): IvrReply => ({ sessionId, state, prompt, expect, ended });
  const sys = { type: "system" as const, id: "ivr", tenantId: null, role: "system" as const };

  if (s.state === "menu") {
    if (digits === "1") {
      if (!s.citizenId) return reply("menu", t("ivr.no_case"), "digit");
      const [c] = await db.select().from(cases).where(eq(cases.citizenId, s.citizenId)).orderBy(desc(cases.createdAt)).limit(1);
      if (!c) return reply("menu", t("ivr.no_case"), "digit");
      const words = STATUS_WORDS[c.status]!;
      const detail =
        c.status === "needs_proof"
          ? { en: "We need one more document. Your helper can send it.", ur: "ہمیں ایک اور کاغذ چاہیے۔ آپ کا مددگار بھیج سکتا ہے۔" }
          : c.status === "paid"
            ? { en: "The money has been sent. You never need to pay a fee.", ur: "رقم بھیج دی گئی ہے۔ آپ کو کبھی فیس نہیں دینی۔" }
            : { en: "", ur: "" };
      const ref = caseRef(c.id).split("").join(" ");
      const en = t("ivr.status", { caseRef: ref, status: words.en, detail: detail.en });
      const ur = t("ivr.status", { caseRef: ref, status: words.ur, detail: detail.ur });
      await set("ended");
      await audit(db, { actor: sys, action: "ivr.status_read", targetType: "case", targetId: c.id });
      return reply("ended", { en: en.en, ur: ur.ur, audioKey: "ivr.status" }, "none", true);
    }
    if (digits === "2") {
      await set("enter_code");
      return reply("enter_code", t("ivr.enter_code"), "digits");
    }
    if (digits === "3") {
      await set("ended");
      if (s.citizenId) {
        const [c] = await db.select().from(cases).where(eq(cases.citizenId, s.citizenId)).orderBy(desc(cases.createdAt)).limit(1);
        if (c) await db.insert(caseNotes).values({ id: newId("nte"), caseId: c.id, authorType: "system", authorId: "ivr", kind: "handoff", body: `Caller ${s.phone} asked to talk to a person (IVR option 3). Please call back.` });
      }
      await audit(db, { actor: sys, action: "ivr.callback_requested", targetType: "citizen", targetId: s.citizenId ?? undefined, detail: { phone: s.phone } });
      return reply("ended", t("ivr.callback"), "none", true);
    }
    return reply("menu", t("ivr.welcome"), "digit");
  }

  if (s.state === "enter_code") {
    const code = digits.replace(/\D/g, "");
    await set("ended", { code });
    if (!s.citizenId) return reply("ended", t("verify.suspicious"), "none", true);
    const mine = await db.select().from(notices).where(eq(notices.citizenId, s.citizenId)).orderBy(desc(notices.issuedAt)).limit(50);
    const hit = mine.find((n) => n.code === code);
    await audit(db, { actor: sys, action: "ivr.code_checked", targetType: "citizen", targetId: s.citizenId, detail: { matched: !!hit } });
    if (!hit) return reply("ended", t("verify.not_linked"), "none", true);
    if (hit.expiresAt < new Date()) return reply("ended", t("verify.expired"), "none", true);
    const msg = t("verify.genuine", { amount: hit.amount ?? "" });
    return reply("ended", { ...msg, en: `${msg.en} Code ${codeForSpeech(code)}.`, ur: `${msg.ur} کوڈ ${codeForSpeech(code)}۔` }, "none", true);
  }
  return reply("ended", t("ivr.callback"), "none", true);
}
