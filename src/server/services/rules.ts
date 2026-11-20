/**
 * Rule versions (Challenge 04) + Digital Twin simulator (bonus).
 * - The active rule set = latest "published" version for the tenant.
 * - Drafts are validated JSON; publishing creates a new version that applies to the next decision.
 * - Old decisions keep pointing at the version they used.
 * - simulate(): re-runs stored decision inputs under a draft and reports who would flip, money
 *   moved and extra human workload — before anything goes live. Nothing is written to cases.
 */
import { and, desc, eq } from "drizzle-orm";
import type { DB, DbOrTx } from "../db/client";
import { ruleSets, decisions } from "../db/schema";
import { ruleSetDefinitionSchema, DEFAULT_RULESET, type RuleSetDefinition } from "../domain/rules";
import { decide, type DecisionInput } from "../domain/decision";
import { newId } from "../lib/ids";
import { audit } from "../lib/audit";
import type { Actor } from "../lib/actor";
import { badRequest, conflict, notFound } from "../lib/errors";
import { emit } from "./events";

export async function activeRuleSet(db: DbOrTx, tenantId: string) {
  const [row] = await db
    .select()
    .from(ruleSets)
    .where(and(eq(ruleSets.tenantId, tenantId), eq(ruleSets.status, "published")))
    .orderBy(desc(ruleSets.version))
    .limit(1);
  if (row) return { id: row.id, version: row.version, definition: ruleSetDefinitionSchema.parse(row.definition), publishedAt: row.publishedAt };
  // Bootstrap v1 for a new tenant.
  const id = newId("rls");
  await db
    .insert(ruleSets)
    .values({ id, tenantId, version: 1, status: "published", definition: DEFAULT_RULESET, note: "Default prototype rules", publishedAt: new Date(), publishedBy: "system" })
    .onConflictDoNothing();
  return activeRuleSet(db, tenantId);
}

export async function listRuleSets(db: DbOrTx, tenantId: string) {
  return db.select().from(ruleSets).where(eq(ruleSets.tenantId, tenantId)).orderBy(desc(ruleSets.version));
}

export function validateDefinition(input: unknown): RuleSetDefinition {
  const parsed = ruleSetDefinitionSchema.safeParse(input);
  if (!parsed.success) throw badRequest("INVALID_RULES", "Rule definition is invalid", parsed.error.issues);
  const th = parsed.data.thresholds;
  if (th.askProofMinScore > th.fastLaneMinScore) throw badRequest("INVALID_THRESHOLDS", "askProofMinScore must be ≤ fastLaneMinScore");
  return parsed.data;
}

export async function createDraft(db: DbOrTx, actor: Actor, tenantId: string, definition: unknown, note?: string) {
  const def = validateDefinition(definition);
  const [latest] = await db.select({ v: ruleSets.version }).from(ruleSets).where(eq(ruleSets.tenantId, tenantId)).orderBy(desc(ruleSets.version)).limit(1);
  const id = newId("rls");
  const version = (latest?.v ?? 0) + 1;
  await db.insert(ruleSets).values({ id, tenantId, version, status: "draft", definition: def, note: note ?? null, createdBy: actor.id });
  await audit(db, { actor, action: "rules.draft_created", targetType: "rule_set", targetId: id, detail: { version, note }, tenantId });
  return { id, version, status: "draft" as const, definition: def };
}

export async function publishRuleSet(db: DB, actor: Actor, tenantId: string, ruleSetId: string) {
  const [rs] = await db.select().from(ruleSets).where(and(eq(ruleSets.id, ruleSetId), eq(ruleSets.tenantId, tenantId)));
  if (!rs) throw notFound("Rule set");
  if (rs.status !== "draft") throw conflict("NOT_A_DRAFT", "Only drafts can be published");
  const previous = await activeRuleSet(db, tenantId);
  await db.transaction(async (tx) => {
    await tx.update(ruleSets).set({ status: "archived" }).where(and(eq(ruleSets.tenantId, tenantId), eq(ruleSets.status, "published")));
    await tx.update(ruleSets).set({ status: "published", publishedAt: new Date(), publishedBy: actor.id }).where(eq(ruleSets.id, ruleSetId));
  });
  await audit(db, { actor, action: "rules.published", targetType: "rule_set", targetId: ruleSetId, detail: { version: rs.version, previousVersion: previous.version }, tenantId });
  await emit(db, tenantId, "rules.published", { ruleSetId, version: rs.version, previousVersion: previous.version });
  return { id: ruleSetId, version: rs.version, previousVersion: previous.version };
}

/** Flip the fast-lane kill switch by publishing a new version (keeps history honest). */
export async function setFastLane(db: DB, actor: Actor, tenantId: string, enabled: boolean, reason: string) {
  const current = await activeRuleSet(db, tenantId);
  if (current.definition.fastLaneEnabled === enabled) return { changed: false, version: current.version };
  const draft = await createDraft(db, actor, tenantId, { ...current.definition, fastLaneEnabled: enabled }, `Fast lane ${enabled ? "enabled" : "disabled"}: ${reason}`);
  const pub = await publishRuleSet(db, actor, tenantId, draft.id);
  return { changed: true, version: pub.version };
}

export type SimulationResult = {
  draftVersion: number | null;
  baselineVersion: number;
  casesReplayed: number;
  flips: { caseId: string; from: string; to: string; eligibleFrom: boolean | null; eligibleTo: boolean | null; amountFrom: number; amountTo: number }[];
  summary: {
    laneCounts: { before: Record<string, number>; after: Record<string, number> };
    newlyEligible: number;
    newlyIneligible: number;
    extraHumanReviews: number;
    benefitDeltaPKR: number;
  };
};

/** Digital Twin: replay the stored inputs of each case's latest real decision under `definition`. */
export async function simulate(db: DbOrTx, tenantId: string, definition: unknown, opts: { draftVersion?: number } = {}): Promise<SimulationResult> {
  const def = validateDefinition(definition);
  const baseline = await activeRuleSet(db, tenantId);
  const rows = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.tenantId, tenantId), eq(decisions.simulated, false)))
    .orderBy(desc(decisions.createdAt));
  const latestByCase = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latestByCase.has(r.caseId)) latestByCase.set(r.caseId, r);

  const before: Record<string, number> = { fast: 0, ask_proof: 0, human: 0 };
  const after: Record<string, number> = { fast: 0, ask_proof: 0, human: 0 };
  const flips: SimulationResult["flips"] = [];
  let newlyEligible = 0;
  let newlyIneligible = 0;
  let benefitDelta = 0;
  for (const d of latestByCase.values()) {
    const trace = d.trace as { input?: Omit<DecisionInput, "ruleSet"> };
    if (!trace.input) continue;
    const old = decide({ ...trace.input, ruleSet: { id: baseline.id, version: baseline.version, definition: baseline.definition } });
    const neu = decide({ ...trace.input, ruleSet: { id: "draft", version: opts.draftVersion ?? 0, definition: def } });
    before[old.lane]!++;
    after[neu.lane]!++;
    if (old.eligible !== true && neu.eligible === true) newlyEligible++;
    if (old.eligible === true && neu.eligible === false) newlyIneligible++;
    const amtFrom = old.eligible ? old.benefitAmount : 0;
    const amtTo = neu.eligible ? neu.benefitAmount : 0;
    benefitDelta += amtTo - amtFrom;
    if (old.lane !== neu.lane || old.eligible !== neu.eligible || amtFrom !== amtTo) {
      flips.push({ caseId: d.caseId, from: old.lane, to: neu.lane, eligibleFrom: old.eligible, eligibleTo: neu.eligible, amountFrom: amtFrom, amountTo: amtTo });
    }
  }
  return {
    draftVersion: opts.draftVersion ?? null,
    baselineVersion: baseline.version,
    casesReplayed: latestByCase.size,
    flips,
    summary: {
      laneCounts: { before, after },
      newlyEligible,
      newlyIneligible,
      extraHumanReviews: (after.human ?? 0) - (before.human ?? 0),
      benefitDeltaPKR: benefitDelta,
    },
  };
}
