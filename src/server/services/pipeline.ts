/**
 * Durable, resumable pipeline (in-database, no external workflow service).
 *  - Each step runs with its own timeout and bounded retries (backoff), and its result is
 *    persisted to pipeline_runs.state before the next step starts.
 *  - Consent is re-checked BEFORE every step that touches personal data, so a withdrawal in the
 *    middle of a run stops it at the next step (status "halted", recorded in the audit log).
 *  - If the process dies mid-run, the run stays "running"; the resume job (or POST /pipelines/{id}/resume)
 *    continues from the first step not marked done. Steps must be idempotent.
 *  - A step marked `degrade` turns a final 503 into a recorded fact (e.g. registry unavailable → S12)
 *    instead of failing the whole run.
 */
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { pipelineRuns } from "../db/schema";
import { newId } from "../lib/ids";
import { AppError } from "../lib/errors";
import { audit } from "../lib/audit";
import type { Actor } from "../lib/actor";
import { activeConsentFor, type Scope } from "./access";
import { enqueueJob } from "./events";

export type StepLog = { name: string; status: string; attempts: number; ms: number; error?: string; at: string };
export type PipelineState = Record<string, unknown> & { __done?: string[] };

export type Step<S extends PipelineState> = {
  name: string;
  timeoutMs?: number;
  retries?: number;
  /** Department consent scopes this step needs; checked live right before it runs. */
  consent?: Scope[];
  /** On a final 503, record the failure via onDegrade and continue instead of failing the run. */
  degrade?: (state: S, error: AppError) => Partial<S>;
  run: (state: S) => Promise<Partial<S>>;
};

export type PipelineResult<S> = { runId: string; status: "done" | "halted" | "failed"; state: S; steps: StepLog[]; haltedAt?: string; haltReason?: string };

async function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new AppError(503, "STEP_TIMEOUT", `Step ${name} timed out after ${ms} ms`)), ms)))]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runPipeline<S extends PipelineState>(
  db: DB,
  args: { kind: string; tenantId: string; caseId: string; citizenId: string; trigger: string; actor: Actor; steps: Step<S>[]; initial: S; resumeRunId?: string; onHalt?: (state: S, reason: string, step: string) => Promise<Partial<S>> },
): Promise<PipelineResult<S>> {
  let runId = args.resumeRunId;
  let state = args.initial;
  let logs: StepLog[] = [];
  if (runId) {
    const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
    if (!run) throw new AppError(404, "NOT_FOUND", "Pipeline run not found");
    if (run.status !== "running") return { runId, status: run.status as "done", state: run.state as S, steps: run.steps };
    state = { ...args.initial, ...(run.state as S) };
    logs = run.steps;
  } else {
    runId = newId("run");
    await db.insert(pipelineRuns).values({ id: runId, tenantId: args.tenantId, caseId: args.caseId, kind: args.kind, status: "running", trigger: args.trigger, state: state as Record<string, unknown> });
    // Safety net: if this process dies, a job resumes the run later.
    await enqueueJob(db, "pipeline.resume", { runId, caseId: args.caseId, kind: args.kind }, new Date(Date.now() + 120_000));
  }
  const done = new Set(state.__done ?? []);
  const persist = async (status: "running" | "done" | "failed" | "halted", error?: string) => {
    await db.update(pipelineRuns).set({ status, steps: logs, state: { ...state, __done: [...done] } as Record<string, unknown>, error: error ?? null, updatedAt: new Date() }).where(eq(pipelineRuns.id, runId!));
  };

  for (const step of args.steps) {
    if (done.has(step.name)) continue;
    // ── consent checkpoint ──
    if (step.consent?.length) {
      const missing: string[] = [];
      for (const scope of step.consent) {
        const ok = await activeConsentFor(db, args.citizenId, { type: "department", id: args.tenantId }, scope);
        if (!ok) missing.push(scope);
      }
      if (missing.length) {
        const reason = `consent missing for ${missing.join(", ")} before step "${step.name}"`;
        logs.push({ name: step.name, status: "halted_consent", attempts: 0, ms: 0, error: reason, at: new Date().toISOString() });
        await audit(db, { actor: args.actor, action: "pipeline.halted", targetType: "case", targetId: args.caseId, outcome: "denied", detail: { runId, step: step.name, missing }, tenantId: args.tenantId });
        if (args.onHalt) {
          state = { ...state, ...(await args.onHalt(state, reason, step.name)) };
          done.add("__halt_handled");
        }
        await persist("halted", reason);
        return { runId: runId!, status: "halted", state, steps: logs, haltedAt: step.name, haltReason: reason };
      }
    }
    // ── run with timeout + retries ──
    const retries = step.retries ?? 0;
    const started = Date.now();
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        const patch = await withTimeout(step.run(state), step.timeoutMs ?? 10_000, step.name);
        state = { ...state, ...patch };
        done.add(step.name);
        logs.push({ name: step.name, status: "done", attempts: attempt, ms: Date.now() - started, at: new Date().toISOString() });
        await persist("running");
        break;
      } catch (e) {
        const err = e instanceof AppError ? e : new AppError(500, "STEP_FAILED", (e as Error).message);
        const retryable = err.status === 503;
        if (retryable && attempt <= retries) {
          await new Promise((r) => setTimeout(r, Math.min(1_000, 150 * attempt)));
          continue;
        }
        if (retryable && step.degrade) {
          state = { ...state, ...step.degrade(state, err) };
          done.add(step.name);
          logs.push({ name: step.name, status: "degraded", attempts: attempt, ms: Date.now() - started, error: err.code, at: new Date().toISOString() });
          await persist("running");
          break;
        }
        logs.push({ name: step.name, status: "failed", attempts: attempt, ms: Date.now() - started, error: `${err.code}: ${err.message}`, at: new Date().toISOString() });
        await persist("failed", err.message);
        throw err;
      }
    }
  }
  await persist("done");
  return { runId: runId!, status: "done", state, steps: logs };
}
