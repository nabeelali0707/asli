/**
 * Ed25519 signing for Signed Truth notices and "prove, don't share" attestations.
 *
 * Token format:  ASLI1.<base64url(canonical JSON payload)>.<base64url(signature)>
 * Any change to any field (amount, case, beneficiary, expiry…) invalidates the signature.
 * The 4-digit spoken code is derived from the signature, so it can't be chosen by an attacker
 * and is unique per notice in practice; it is an accessibility aid, not the proof itself.
 *
 * Keys: SIGNING_PRIVATE_KEY / SIGNING_PUBLIC_KEY (PEM) in production. In development the key
 * pair is generated once and stored in the settings table (prototype convenience — documented).
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { settings } from "../db/schema";
import type { DB } from "../db/client";
import { env } from "../env";
import { b64url, canonicalJson, fromB64url, sha256Hex } from "./crypto";

export const TOKEN_PREFIX = "ASLI1";

type KeyPair = { kid: string; privateKey: crypto.KeyObject; publicKey: crypto.KeyObject; publicPem: string };
let cachedKey: KeyPair | undefined;

function pem(value: string): string {
  return value.includes("BEGIN") ? value : Buffer.from(value, "base64").toString("utf8");
}

function kidFor(publicPem: string) {
  return "k_" + sha256Hex(publicPem).slice(0, 12);
}

export async function getSigningKey(db: DB): Promise<KeyPair> {
  if (cachedKey) return cachedKey;
  const e = env();
  if (e.SIGNING_PRIVATE_KEY && e.SIGNING_PUBLIC_KEY) {
    const publicPem = pem(e.SIGNING_PUBLIC_KEY);
    cachedKey = {
      kid: kidFor(publicPem),
      privateKey: crypto.createPrivateKey(pem(e.SIGNING_PRIVATE_KEY)),
      publicKey: crypto.createPublicKey(publicPem),
      publicPem,
    };
    return cachedKey;
  }
  const [row] = await db.select().from(settings).where(eq(settings.key, "signing_key"));
  let privatePem: string;
  let publicPem: string;
  if (row) {
    ({ privatePem, publicPem } = row.value as { privatePem: string; publicPem: string });
  } else {
    const kp = crypto.generateKeyPairSync("ed25519");
    privatePem = kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    publicPem = kp.publicKey.export({ type: "spki", format: "pem" }).toString();
    await db
      .insert(settings)
      .values({ key: "signing_key", value: { privatePem, publicPem } })
      .onConflictDoNothing();
    // Re-read in case another process won the race.
    const [again] = await db.select().from(settings).where(eq(settings.key, "signing_key"));
    ({ privatePem, publicPem } = again!.value as { privatePem: string; publicPem: string });
  }
  cachedKey = {
    kid: kidFor(publicPem),
    privateKey: crypto.createPrivateKey(privatePem),
    publicKey: crypto.createPublicKey(publicPem),
    publicPem,
  };
  return cachedKey;
}

export function resetSigningKeyCache() {
  cachedKey = undefined;
}

export type SignedPayload = Record<string, unknown> & { kid: string; typ: string; iat: string; exp: string };

export async function signPayload(db: DB, payload: Omit<SignedPayload, "kid">): Promise<{ token: string; signature: Buffer; kid: string; payload: SignedPayload }> {
  const key = await getSigningKey(db);
  const full = { ...payload, kid: key.kid } as SignedPayload;
  const body = canonicalJson(full);
  const signature = crypto.sign(null, Buffer.from(body), key.privateKey);
  return { token: `${TOKEN_PREFIX}.${b64url(body)}.${b64url(signature)}`, signature, kid: key.kid, payload: full };
}

export type VerifyResult =
  | { ok: true; payload: SignedPayload }
  | { ok: false; reason: "MALFORMED" | "UNKNOWN_KEY" | "BAD_SIGNATURE"; payload?: Record<string, unknown> };

export async function verifyToken(db: DB, token: string): Promise<VerifyResult> {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return { ok: false, reason: "MALFORMED" };
  let body: string;
  let payload: Record<string, unknown>;
  try {
    body = fromB64url(parts[1]!).toString("utf8");
    payload = JSON.parse(body);
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  const key = await getSigningKey(db);
  if (payload.kid !== key.kid) return { ok: false, reason: "UNKNOWN_KEY", payload };
  // Re-canonicalise so whitespace/key-order games cannot slip through.
  const canonical = canonicalJson(payload);
  if (canonical !== body) return { ok: false, reason: "BAD_SIGNATURE", payload };
  const valid = crypto.verify(null, Buffer.from(canonical), key.publicKey, fromB64url(parts[2]!));
  if (!valid) return { ok: false, reason: "BAD_SIGNATURE", payload };
  return { ok: true, payload: payload as SignedPayload };
}

/** 4-digit code a person can hear and repeat, derived from the signature. */
export function spokenCode(signature: Buffer): string {
  const n = parseInt(sha256Hex(signature).slice(0, 8), 16) % 10000;
  return n.toString().padStart(4, "0");
}

/** "4 8 2 1" → for TTS so digits are read one by one. */
export function codeForSpeech(code: string): string {
  return code.split("").join(" ");
}

export async function publicKeyInfo(db: DB) {
  const key = await getSigningKey(db);
  return { kid: key.kid, alg: "Ed25519", publicKeyPem: key.publicPem };
}

/** Find a signed token embedded in free text (SMS body, forwarded message). */
export function extractToken(text: string): string | null {
  const m = text.match(/ASLI1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}
