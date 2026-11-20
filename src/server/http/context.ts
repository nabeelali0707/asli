import type { DB } from "../db/client";
import type { Actor } from "../lib/actor";

export type AppEnv = {
  Variables: {
    db: DB;
    requestId: string;
    actor?: Actor;
    /** Helper mode: citizen this request acts for (from a family token) + consent id. */
    actFor?: { citizenId: string; consentId: string };
  };
};
