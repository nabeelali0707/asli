import crypto from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford-ish base32, no i/l/o/u

/** Readable, prefixed, random id: e.g. case_7k2m9x4q1h8z3w5r */
export function newId(prefix: string, length = 16): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % 32];
  return `${prefix}_${out}`;
}
