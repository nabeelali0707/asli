"use client";

/**
 * Tiny client for the Asli API. Stores the session in localStorage (prototype),
 * adds an Idempotency-Key to every write so a retry on a weak connection never
 * repeats an action, and surfaces RFC 9457 problem details as ApiError.
 */
export type Role = "citizen" | "helper" | "officer" | "admin" | "auditor";
export type SessionUser = { id: string; email: string; role: Role; displayName: string; tenantId: string; citizenId: string | null; canSecondApprove: boolean };
export type Session = { token: string; expiresAt: string; user: SessionUser };
export type FamilySession = { token: string; expiresAt: string; citizenId: string; name: string };

const KEY = "asli.session";
const FAMILY_KEY = "asli.family";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

function read<T>(k: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(k: string, v: unknown) {
  try {
    if (v === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export const session = {
  get: () => {
    const s = read<Session>(KEY);
    if (s && new Date(s.expiresAt) < new Date()) {
      write(KEY, null);
      return null;
    }
    return s;
  },
  set: (s: Session | null) => write(KEY, s),
  family: () => {
    const f = read<FamilySession>(FAMILY_KEY);
    if (f && new Date(f.expiresAt) < new Date()) {
      write(FAMILY_KEY, null);
      return null;
    }
    return f;
  },
  setFamily: (f: FamilySession | null) => write(FAMILY_KEY, f),
};

export function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type Opts = { method?: string; body?: unknown; asFamily?: boolean; anonymous?: boolean; idempotencyKey?: string };

export async function api<T = Record<string, unknown>>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const fam = opts.asFamily ? session.family() : null;
  const s = session.get();
  if (!opts.anonymous) {
    if (fam) headers.authorization = `Bearer ${fam.token}`;
    else if (s) headers.authorization = `Bearer ${s.token}`;
  }
  if (method !== "GET") headers["idempotency-key"] = opts.idempotencyKey ?? newKey();
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new ApiError(0, "OFFLINE", "No connection. Your work is saved on this phone and will be sent when the signal comes back.");
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401 && !opts.anonymous) session.set(null);
    throw new ApiError(res.status, json.code ?? json.error?.code ?? "ERROR", json.detail ?? json.error?.message ?? "Something went wrong", json.details);
  }
  return json as T;
}

export function homeFor(role: Role) {
  return { citizen: "/app/citizen", helper: "/app/helper", officer: "/app/officer", admin: "/app/admin", auditor: "/app/auditor" }[role];
}

/** Speak a message aloud — Urdu voice when the device has one, else English. */
export function speak(text: { en: string; ur: string }, lang: "ur" | "en" = "ur") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const voices = synth.getVoices();
  const ur = voices.find((v) => v.lang.toLowerCase().startsWith("ur"));
  const useUrdu = lang === "ur" && !!ur;
  const u = new SpeechSynthesisUtterance(useUrdu ? text.ur : text.en);
  if (useUrdu && ur) u.voice = ur;
  u.lang = useUrdu ? "ur-PK" : "en-US";
  u.rate = 0.92;
  synth.speak(u);
  return true;
}
