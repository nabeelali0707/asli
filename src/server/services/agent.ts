/**
 * Case agent (AI feature: autonomous agent + tool calling, with guardrails + human approval).
 *
 * The agent plans and runs the case steps by calling tools: mock NADRA, mock income registry,
 * the document checker, the decision engine, proof requests and officer hand-off. Every tool call
 * is written to the case timeline and the audit log with actor "agent".
 *
 * Guardrails (enforced in code, not in the prompt):
 *  - initiate_payout always returns 403 AI_CANNOT_INITIATE_PAYMENT and is logged.
 *  - No approve / reject tool exists. The agent can only prepare and hand off.
 *  - Lookups run as the agent and need the department's consent (withdrawn consent → tool error).
 *
 * Live mode: Claude drives the tool loop (SDK tool runner). Offline: a fixed, explainable plan.
 */
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { cases, caseNotes, documents } from "../db/schema";
import { AGENT_ACTOR, type Actor } from "../lib/actor";
import { audit } from "../lib/audit";
import { newId } from "../lib/ids";
import { AppError, notFound } from "../lib/errors";
import { nadraLookup, incomeLookup } from "./mockdpi";
import { runDecision, escalateCase, releasePayout } from "./cases";
import { claudeAvailable, getClaudeClient } from "../ai/claude";
import { env } from "../env";

type Step = { tool: string; input: unknown; output: unknown; ok: boolean; at: string };

export async function runCaseAgent(db: DB, requestedBy: Actor, caseId: string) {
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!c) throw notFound("Case");
  const agent = AGENT_ACTOR(c.tenantId);
  const steps: Step[] = [];

  const log = async (tool: string, input: unknown, fn: () => Promise<unknown>) => {
    let output: unknown;
    let ok = true;
    try {
      output = await fn();
    } catch (e) {
      ok = false;
      output = e instanceof AppError ? { error: e.code, message: e.message } : { error: "TOOL_FAILED", message: (e as Error).message };
    }
    const step = { tool, input, output, ok, at: new Date().toISOString() };
    steps.push(step);
    await db.insert(caseNotes).values({ id: newId("nte"), caseId, authorType: "agent", authorId: agent.id, kind: "agent_step", body: `${tool} → ${ok ? "ok" : (output as { error: string }).error}`, data: step });
    await audit(db, { actor: agent, action: `agent.tool.${tool}`, targetType: "case", targetId: caseId, outcome: ok ? "ok" : (output as { error?: string }).error === "AI_CANNOT_INITIATE_PAYMENT" ? "denied" : "error", detail: { input, ok }, tenantId: c.tenantId });
    return output;
  };
  const ctx = { actor: agent };

  const tools = {
    get_case_summary: () =>
      log("get_case_summary", {}, async () => {
        const docs = await db.select({ kind: documents.kind, checks: documents.checks }).from(documents).where(eq(documents.caseId, caseId));
        return { status: c.status, type: c.type, claimFields: Object.keys(c.claim), documents: docs.map((d) => ({ kind: d.kind, readable: (d.checks as { readable?: boolean })?.readable, tamper: (d.checks as { tamperScore?: number })?.tamperScore })) };
      }),
    lookup_identity: () =>
      log("lookup_identity", {}, async () => {
        const r = await nadraLookup(db, ctx, c.citizenId);
        return r ? { found: true, district: r.district, maritalStatus: r.maritalStatus, alive: r.alive } : { found: false };
      }),
    lookup_income: () =>
      log("lookup_income", {}, async () => {
        const r = await incomeLookup(db, ctx, c.citizenId);
        return r ? { found: true, monthlyIncome: r.monthlyIncome, householdSize: r.householdSize } : { found: false };
      }),
    run_decision: () => log("run_decision", {}, async () => {
      const d = await runDecision(db, caseId, { trigger: "agent" });
      return { lane: d.lane, score: d.score, eligible: d.eligible, proofItems: d.proofItems, reasonCodes: d.reasonCodes, hardStops: d.hardStops };
    }),
    handoff_to_officer: (note: string) => log("handoff_to_officer", { note }, () => escalateCase(db, agent, caseId, `Agent hand-off: ${note}`)),
    // Guardrail demo: releasePayout refuses every non-human actor with 403 AI_CANNOT_INITIATE_PAYMENT.
    initiate_payout: (amount: number) => log("initiate_payout", { amount }, () => releasePayout(db, agent, `case:${caseId}`)),
  };

  let mode: "claude" | "deterministic" = "deterministic";
  let summary = "";
  if (claudeAvailable()) {
    mode = "claude";
    const client = getClaudeClient();
    const final = await client.beta.messages.toolRunner({
      model: env().ANTHROPIC_MODEL,
      max_tokens: 8000,
      max_iterations: 8,
      output_config: { effort: "low" },
      system:
        "You are the case agent for a relief-payment PROTOTYPE. Prepare the case for a human officer: read the summary, check identity and income, run the decision engine, and hand off to an officer with a short note if the decision lane is 'human' or anything looks wrong. You cannot approve, reject or pay; payouts are for humans only. Finish with a 1-3 sentence summary for the officer.",
      messages: [{ role: "user", content: `Prepare case ${caseId}.` }],
      tools: [
        betaZodTool({ name: "get_case_summary", description: "Get the case status, claim fields present and document checks.", inputSchema: z.object({}), run: async () => JSON.stringify(await tools.get_case_summary()) }),
        betaZodTool({ name: "lookup_identity", description: "Look up the applicant in the (mock) NADRA identity registry. Needs department consent.", inputSchema: z.object({}), run: async () => JSON.stringify(await tools.lookup_identity()) }),
        betaZodTool({ name: "lookup_income", description: "Look up the applicant in the (mock) income registry. Needs department consent.", inputSchema: z.object({}), run: async () => JSON.stringify(await tools.lookup_income()) }),
        betaZodTool({ name: "run_decision", description: "Run the deterministic decision engine (fast / ask_proof / human lane).", inputSchema: z.object({}), run: async () => JSON.stringify(await tools.run_decision()) }),
        betaZodTool({ name: "handoff_to_officer", description: "Hand the case to a human officer with a note.", inputSchema: z.object({ note: z.string() }), run: async (i) => JSON.stringify(await tools.handoff_to_officer(i.note)) }),
        betaZodTool({ name: "initiate_payout", description: "Attempt to release money to the applicant.", inputSchema: z.object({ amount: z.number() }), run: async (i) => JSON.stringify(await tools.initiate_payout(i.amount)) }),
      ],
    });
    summary = final.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  } else {
    await tools.get_case_summary();
    await tools.lookup_identity();
    await tools.lookup_income();
    const d = (await tools.run_decision()) as { lane?: string; reasonCodes?: string[]; hardStops?: string[] };
    if (d.lane === "human") await tools.handoff_to_officer(`Decision engine is not sure: ${[...(d.hardStops ?? []), ...(d.reasonCodes ?? [])].join(", ")}`);
    // Demonstrate the guardrail: the agent's attempt to pay is refused and logged.
    await tools.initiate_payout(0);
    summary = `Prepared case: lane ${d.lane ?? "unknown"}. ${d.lane === "human" ? "Handed to an officer." : ""} Payout attempt blocked by guardrail (AI never moves money).`;
  }
  await audit(db, { actor: requestedBy, action: "agent.run", targetType: "case", targetId: caseId, detail: { mode, steps: steps.length }, tenantId: c.tenantId });
  return { caseId, mode, steps, summary };
}
