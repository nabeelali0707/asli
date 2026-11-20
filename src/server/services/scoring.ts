import { desc, eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { scoringModels } from "../db/schema";
import type { ScoringModel } from "../domain/calibration";

export async function activeScoringModel(db: DbOrTx): Promise<ScoringModel | null> {
  const [row] = await db.select().from(scoringModels).where(eq(scoringModels.active, true)).orderBy(desc(scoringModels.version)).limit(1);
  return row ? ({ ...(row.model as Omit<ScoringModel, "version">), version: row.version } as ScoringModel) : null;
}

export async function listScoringModels(db: DbOrTx) {
  return db.select({ id: scoringModels.id, version: scoringModels.version, active: scoringModels.active, metrics: scoringModels.metrics, datasetHash: scoringModels.datasetHash, createdAt: scoringModels.createdAt }).from(scoringModels).orderBy(desc(scoringModels.version));
}
