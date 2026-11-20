import type { Role } from "../db/schema";

/** Who is making a request. Resolved server-side from a JWT or an API key — never from the client body. */
export type Actor =
  | {
      type: "user";
      id: string;
      role: Role;
      tenantId: string;
      citizenId: string | null;
      displayName: string;
      canSecondApprove: boolean;
    }
  | { type: "api_key"; id: string; tenantId: string; scopes: string[]; role: "api" }
  | { type: "ai" | "agent" | "system"; id: string; tenantId: string | null; role: "ai" | "agent" | "system" };

export const SYSTEM_ACTOR: Actor = { type: "system", id: "system", tenantId: null, role: "system" };
export const AI_ACTOR = (tenantId: string): Actor => ({ type: "ai", id: "asli-decision-engine", tenantId, role: "ai" });
export const AGENT_ACTOR = (tenantId: string): Actor => ({ type: "agent", id: "asli-case-agent", tenantId, role: "agent" });
