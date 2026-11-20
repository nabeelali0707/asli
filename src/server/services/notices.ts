/**
 * Signed Truth — issuing side. Every message Asli sends about a case is an Ed25519-signed
 * notice bound to: notice id, case, beneficiary, type, amount, issue + expiry time and a nonce.
 * The citizen hears a 4-digit code; the SMS carries a verify link with the full token.
 */
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { notices, notifications, users } from "../db/schema";
import { newId } from "../lib/ids";
import { randomToken } from "../lib/crypto";
import { signPayload, spokenCode, codeForSpeech } from "../lib/signing";
import { t, type MessageKey } from "../lib/i18n";
import { enqueueJob } from "./events";
import { env } from "../env";

export type NoticeType = "payment_released" | "decision" | "proof_requested" | "case_received";

export function caseRef(caseId: string) {
  return caseId.replace(/^case_/, "").slice(0, 6).toUpperCase();
}

export async function issueNotice(
  db: DB,
  args: { tenantId: string; caseId: string; citizenId: string; type: NoticeType; amount?: number | null; ttlDays?: number },
) {
  const id = newId("ntc");
  const nonce = randomToken(12);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (args.ttlDays ?? 30) * 864e5);
  const signed = await signPayload(db, {
    typ: "notice",
    nid: id,
    ntype: args.type,
    cid: args.caseId,
    sub: args.citizenId,
    amt: args.amount ?? null,
    iat: issuedAt.toISOString(),
    exp: expiresAt.toISOString(),
    nonce,
  });
  const code = spokenCode(signed.signature);
  await db.insert(notices).values({
    id,
    tenantId: args.tenantId,
    caseId: args.caseId,
    citizenId: args.citizenId,
    type: args.type,
    amount: args.amount ?? null,
    payload: signed.payload,
    token: signed.token,
    code,
    nonce,
    keyId: signed.kid,
    issuedAt,
    expiresAt,
  });

  const msg = t(`notice.${args.type}` as MessageKey, { amount: args.amount ?? "", caseRef: caseRef(args.caseId), code });
  const verifyUrl = `${env().PUBLIC_BASE_URL}/v/${signed.token}`;
  const body = { en: `${msg.en}\nVerify: ${verifyUrl}`, ur: `${msg.ur}\nتصدیق: ${verifyUrl}` };

  // In-app for the citizen's account (if any) + mock SMS to their phone.
  const [citizenUser] = await db.select({ id: users.id }).from(users).where(eq(users.citizenId, args.citizenId));
  for (const channel of ["in_app", "sms"] as const) {
    const nid = newId("ntf");
    await db.insert(notifications).values({
      id: nid,
      tenantId: args.tenantId,
      userId: channel === "in_app" ? (citizenUser?.id ?? null) : null,
      citizenId: args.citizenId,
      channel,
      title: `notice.${args.type}`,
      body,
      audioKey: `notice.${args.type}`,
      noticeId: id,
      status: channel === "in_app" ? "sent" : "queued",
    });
    if (channel === "sms") await enqueueJob(db, "notification.send", { notificationId: nid });
  }
  return { id, token: signed.token, code, spokenCode: codeForSpeech(code), verifyUrl, message: body, audioKey: msg.audioKey, expiresAt };
}

export async function notifyUser(db: DB, args: { tenantId: string; userId: string | null; citizenId?: string | null; title: string; body: { en: string; ur: string }; audioKey?: string }) {
  const id = newId("ntf");
  await db.insert(notifications).values({
    id,
    tenantId: args.tenantId,
    userId: args.userId,
    citizenId: args.citizenId ?? null,
    channel: "in_app",
    title: args.title,
    body: args.body,
    audioKey: args.audioKey ?? null,
    status: "sent",
  });
  return id;
}
