import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { env } from "../env";
import type { Role } from "../db/schema";

const key = () => new TextEncoder().encode(env().JWT_SECRET);

export type AccessClaims = {
  sub: string;
  tid: string;
  role: Role;
  tv: number;
  /** Helper mode: the citizen this short-lived token acts for, and the consent that allows it. */
  af?: string;
  afc?: string;
  typ: "access" | "family";
  /** Citizen app on a shared phone: epoch seconds when the family PIN was last entered (lock screen). */
  pv?: number;
};

export async function issueToken(claims: AccessClaims, ttlSeconds = env().JWT_TTL_SECONDS): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .setIssuer("asli")
    .setAudience("asli-api")
    .sign(key());
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "asli", audience: "asli-api" });
    return payload as unknown as AccessClaims;
  } catch {
    return null;
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
