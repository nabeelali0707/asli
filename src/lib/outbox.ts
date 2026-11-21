"use client";

/**
 * Offline-first outbox. Anything done with no signal is saved on this phone and replayed to
 * POST /sync in order when the connection returns. Every op has its own opId, so a replay after a
 * dropped connection never creates a case or a document twice.
 *
 * Shared-phone safety: work saved for a FAMILY is encrypted (AES-GCM) with a key derived from that
 * family's PIN. The key lives only in memory, so when the app auto-locks (or the page reloads) the
 * saved data is unreadable until the PIN is entered again, and one tap wipes it.
 */
import { api, newKey, session, ApiError } from "@/lib/api";

export type OutboxOp =
  | { opId: string; type: "create_case"; clientRef: string; payload: { claim?: Record<string, unknown>; type?: "relief_claim" | "complaint" } }
  | { opId: string; type: "add_document"; caseRef: string; payload: { kind: "cnic" | "income_proof" | "other"; mime: string; contentBase64: string } }
  | { opId: string; type: "submit_case"; caseRef: string };

type Entry = { owner: string; at: string; error?: string; op?: OutboxOp; sealed?: { iv: string; data: string } };
const KEY = "asli.outbox";
const famKeys = new Map<string, CryptoKey>(); // memory only

function load(): Entry[] {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as Entry[];
  } catch {
    return [];
  }
}
function save(e: Entry[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(e));
    window.dispatchEvent(new Event("asli:outbox"));
  } catch {
    throw new Error("This phone is out of space. Please sync or clear some saved work.");
  }
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function unlockFamily(citizenId: string, pin: string) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  famKeys.set(
    citizenId,
    await crypto.subtle.deriveKey({ name: "PBKDF2", salt: new TextEncoder().encode("asli:" + citizenId), iterations: 100_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
  );
}
export function lockAll() {
  famKeys.clear();
}
export const isUnlocked = (citizenId: string) => famKeys.has(citizenId);

async function seal(owner: string, op: OutboxOp): Promise<Entry> {
  const base: Entry = { owner, at: new Date().toISOString() };
  const key = owner.startsWith("fam:") ? famKeys.get(owner.slice(4)) : undefined;
  if (!key) return { ...base, op };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(op))));
  return { ...base, sealed: { iv: b64(iv), data: b64(data) } };
}
async function open(e: Entry): Promise<OutboxOp | null> {
  if (e.op) return e.op;
  const key = e.owner.startsWith("fam:") ? famKeys.get(e.owner.slice(4)) : undefined;
  if (!key || !e.sealed) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(e.sealed.iv) }, key, unb64(e.sealed.data));
    return JSON.parse(new TextDecoder().decode(plain)) as OutboxOp;
  } catch {
    return null;
  }
}

export const currentOwner = () => {
  const f = session.family();
  if (f) return `fam:${f.citizenId}`;
  const s = session.get();
  return s ? `usr:${s.user.id}` : null;
};

export const outbox = {
  count: (owner?: string | null) => load().filter((e) => !owner || e.owner === owner).length,
  async add(op: OutboxOp) {
    const owner = currentOwner();
    if (!owner) throw new Error("Please sign in first.");
    save([...load(), await seal(owner, op)]);
  },
  wipe(owner: string) {
    save(load().filter((e) => e.owner !== owner));
  },
  errors: () => load().filter((e) => e.error),
};

let flushing = false;
/** Send everything this signed-in person has saved. Returns what happened; never throws. */
export async function flushOutbox(): Promise<{ sent: number; left: number; locked: number; offline: boolean }> {
  const owner = currentOwner();
  if (!owner || flushing) return { sent: 0, left: owner ? outbox.count(owner) : 0, locked: 0, offline: false };
  flushing = true;
  try {
    const all = load();
    const mine = all.filter((e) => e.owner === owner);
    const ready: { e: Entry; op: OutboxOp }[] = [];
    let locked = 0;
    for (const e of mine) {
      const op = await open(e);
      if (op) ready.push({ e, op });
      else locked++;
    }
    let sent = 0;
    for (let i = 0; i < ready.length; i += 40) {
      const batch = ready.slice(i, i + 40);
      try {
        const r = await api<{ results: { opId: string; status: string; error?: { message: string } }[] }>("/sync", { body: { ops: batch.map((b) => b.op) }, asFamily: owner.startsWith("fam:") });
        const done = new Set(r.results.filter((x) => x.status !== "failed").map((x) => x.opId));
        const failed = new Map(r.results.filter((x) => x.status === "failed").map((x) => [x.opId, x.error?.message ?? "failed"]));
        const now = load()
          .filter((e) => !batch.some((b) => b.e.at === e.at && b.e.owner === e.owner && done.has(b.op.opId)))
          .map((e) => {
            const hit = batch.find((b) => b.e.at === e.at && b.e.owner === e.owner);
            return hit && failed.has(hit.op.opId) ? { ...e, error: failed.get(hit.op.opId) } : e;
          });
        save(now);
        sent += done.size;
      } catch (err) {
        if (err instanceof ApiError && err.status === 0) return { sent, left: outbox.count(owner), locked, offline: true };
        throw err;
      }
    }
    return { sent, left: outbox.count(owner), locked, offline: false };
  } catch {
    return { sent: 0, left: outbox.count(owner), locked: 0, offline: false };
  } finally {
    flushing = false;
  }
}

export { newKey };
