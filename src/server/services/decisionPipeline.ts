/**
 * The decision run as a durable pipeline (services/pipeline.ts):
 *
 *   load_case → identity_lookup → registry_search → income_lookup → documents → duplicates
 *   → payout_account → advisory_signals → calibrated_score → decide → persist
 *
 * - Consent is re-checked before every data step; a withdrawal mid-run halts the run and the case
 *   goes to a human with hard stop S6 — no further data is read.
 * - A registry outage (chaos panel / circuit breaker) is retried, then recorded as S12 — never guessed.
 * - Lane "auto" = PROVISIONAL approval: money reserved, cooling-off, cancellable, release by a human.
 */
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { cases, citizens, documents, decisions, caseNotes, payouts, payoutAliasChanges, type CaseStatus } from "../db/schema";
import { newId } from "../lib/ids";
import { audit } from "../lib/audit";
import { AI_ACTOR, type Actor } from "../lib/actor";
import { AppError, notFound } from "../lib/errors";
import { canonicalJson, sha256Hex } from "../lib/crypto";
import { nadraLookup, nadraSearch, incomeLookup } from "./mockdpi";
import { activeRuleSet } from "./rules";
import { issueNotice, notifyUser } from "./notices";
import { emit, enqueueJob, registerJob } from "./events";
import { caseSignals, urgencyAndKind } from "../ai/signals";
import { matchIdentity, findDuplicateCandidates, normalizeCnic, type IdentityMatch } from "../domain/names";
import { decide, type DecisionInput, type DocumentEvidence, type DecisionOutput, type ClassifierSignal } from "../domain/decision";
import { scanForInjection, label } from "../domain/hardstops";
import { hamming, DHASH_REUSE_BITS } from "../domain/documents";
import { calibratedP } from "../domain/calibration";
import type { Facts } from "../domain/rules";
import { runPipeline, type Step } from "./pipeline";
import { activeScoringModel } from "./scoring";
import { recordAiDecision } from "./aidecisions";
import { t } from "../lib/i18n";

type ClaimInput = Record<string, unknown> & {
  fullName?: string | null;
  fatherName?: string | null;
  cnic?: string | null;
  dob?: string | null;
  maritalStatus?: string | null;
  householdSize?: number | null;
  monthlyIncome?: number | null;
  statement?: string | null;
};

type Registry = { fullName: string; fatherName: string; cnic: string; dob: string; gender: string; district: string; maritalStatus: string; alive: boolean } | null;

type S = {
  __done?: string[];
  caseId: string;
  claim?: ClaimInput;
  citizen?: { id: string; fullName: string; fatherName: string | null; cnic: string | null; dob: string | null; gender: string | null; district: string | null; payoutAlias: string | null; tenantId: string };
  registry?: Registry;
  registryUnavailable: string[];
  income?: { monthlyIncome: number; householdSize: number } | null;
  search?: { ambiguous: boolean; bestBits: number | null; bestZone: string | null; candidates: { id: string; bits: number; zone: string }[] } | null;
  docEvidence?: DocumentEvidence[];
  docQr?: { cnic?: string | null; fullName?: string | null; fatherName?: string | null; dob?: string | null; monthlyIncome?: number | null } | null;
  reusedImage?: boolean;
  reuseDetail?: unknown;
  injection?: { found: boolean; matches: { pattern: string; excerpt: string }[] };
  duplicates?: { id: string; reason: string }[];
  payoutAccount?: { changedRecently: boolean; sharedWith: string[] };
  signals?: ClassifierSignal[];
  signalsMeta?: unknown;
  calibrated?: { p: number; raw: number; modelVersion: number } | null;
  consentMissing?: string[];
  decisionId?: string;
};

function ageFrom(dob: string | null | undefined): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const d = new Date(dob + "T00:00:00Z");
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

async function recentPaymentDays(db: DB, citizenId: string, excludeCaseId: string): Promise<number> {
  const rows = await db
    .select({ releasedAt: payouts.releasedAt })
    .from(payouts)
    .where(and(eq(payouts.citizenId, citizenId), eq(payouts.status, "released"), ne(payouts.caseId, excludeCaseId)))
    .orderBy(desc(payouts.releasedAt))
    .limit(1);
  if (!rows[0]?.releasedAt) return 99999;
  return Math.floor((Date.now() - rows[0].releasedAt.getTime()) / 864e5);
}

export async function runDecision(db: DB, caseId: string, opts: { trigger: string; requestId?: string; resumeRunId?: string }) {
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!c) throw notFound("Case");
  const ai = AI_ACTOR(c.tenantId);
  const ctx = { actor: ai as Actor, requestId: opts.requestId };
  const ruleSet = await activeRuleSet(db, c.tenantId);

  const steps: Step<S>[] = [
    {
      name: "load_case",
      run: async () => {
        const [cz] = await db.select().from(citizens).where(eq(citizens.id, c.citizenId));
        return {
          claim: c.claim as ClaimInput,
          citizen: { id: cz!.id, fullName: cz!.fullName, fatherName: cz!.fatherName, cnic: cz!.cnic, dob: cz!.dob, gender: cz!.gender, district: cz!.district, payoutAlias: cz!.payoutAlias, tenantId: cz!.tenantId },
        };
      },
    },
    {
      name: "identity_lookup",
      consent: ["identity.read"],
      timeoutMs: 6_000,
      retries: 2,
      degrade: (st) => ({ registry: null, registryUnavailable: [...st.registryUnavailable, "nadra"] }),
      run: async () => ({ registry: (await nadraLookup(db, ctx, c.citizenId)) as Registry }),
    },
    {
      name: "registry_search",
      consent: ["identity.read"],
      timeoutMs: 6_000,
      retries: 1,
      degrade: (st) => ({ search: null, registryUnavailable: [...new Set([...st.registryUnavailable, "nadra"])] }),
      run: async (st) => {
        // Only needed when we could not look the person up by CNIC.
        if (st.registry || st.registryUnavailable.includes("nadra")) return { search: null };
        const claim = st.claim ?? {};
        const r = await nadraSearch(db, ctx, c.citizenId, {
          id: "claim",
          fullName: claim.fullName ?? st.citizen!.fullName,
          fatherName: claim.fatherName ?? st.citizen!.fatherName,
          dob: claim.dob ?? st.citizen!.dob,
          gender: st.citizen!.gender,
          district: st.citizen!.district,
        });
        return { search: { ambiguous: r.ambiguous, bestBits: r.best?.bits ?? null, bestZone: r.best?.zone ?? null, candidates: r.candidates.map((x) => ({ id: x.id.slice(0, 5) + "…", bits: x.bits, zone: x.zone })) } };
      },
    },
    {
      name: "income_lookup",
      consent: ["income.read"],
      timeoutMs: 6_000,
      retries: 2,
      degrade: (st) => ({ income: null, registryUnavailable: [...new Set([...st.registryUnavailable, "income"])] }),
      run: async () => {
        const r = await incomeLookup(db, ctx, c.citizenId);
        return { income: r ? { monthlyIncome: r.monthlyIncome, householdSize: r.householdSize } : null };
      },
    },
    {
      name: "documents",
      consent: ["documents.read"],
      run: async (st) => {
        const docs = await db.select().from(documents).where(eq(documents.caseId, caseId));
        const claimCnic = st.claim?.cnic ?? st.citizen!.cnic;
        const evidence: DocumentEvidence[] = docs.map((d) => {
          const ch = (d.checks ?? {}) as { readable?: boolean; blurry?: boolean; qr?: { valid: boolean | null }; tamperScore?: number };
          const ex = (d.extracted ?? {}) as { cnic?: string | null };
          return {
            kind: d.kind,
            readable: !!ch.readable,
            blurry: !!ch.blurry,
            qrValid: ch.qr?.valid ?? null,
            tamperScore: ch.tamperScore ?? 0,
            fieldsMatchClaim: ex.cnic && claimCnic ? normalizeCnic(ex.cnic) === normalizeCnic(claimCnic) : null,
          };
        });
        // S8: an image already used by a DIFFERENT applicant. Templated forms look alike to a perceptual
        // hash (measured: two different people's mock CNICs differ by 1/64 bits), so a near-duplicate only
        // counts when it also carries the SAME identity (same CNIC in the signed QR); byte-identical always counts.
        const others = docs.length
          ? await db
              .select({ dhash: documents.dhash, sha256: documents.sha256, extracted: documents.extracted, citizenId: documents.citizenId, id: documents.id })
              .from(documents)
              .where(and(eq(documents.tenantId, c.tenantId), ne(documents.citizenId, c.citizenId)))
          : [];
        const reuse: { doc: string; other: string; how: string; bits?: number }[] = [];
        for (const d of docs) {
          const dCnic = normalizeCnic((d.extracted as { cnic?: string } | null)?.cnic);
          for (const o of others) {
            if (o.sha256 === d.sha256) {
              reuse.push({ doc: d.id, other: o.id, how: "byte-identical image" });
              continue;
            }
            const oCnic = normalizeCnic((o.extracted as { cnic?: string } | null)?.cnic);
            if (d.dhash && o.dhash && dCnic && oCnic && dCnic === oCnic) {
              const bits = hamming(d.dhash, o.dhash);
              if (bits <= DHASH_REUSE_BITS) reuse.push({ doc: d.id, other: o.id, how: "near-identical image with the same identity", bits });
            }
          }
        }
        // S9: instructions aimed at the system, anywhere in the applicant-supplied text.
        const texts = [
          st.claim?.statement as string | undefined,
          ...docs.map((d) => ((d.checks as { qr?: { rawText?: string } } | null)?.qr?.rawText ?? null)),
          ...docs.map((d) => JSON.stringify(d.extracted ?? {})),
        ];
        const injection = scanForInjection(texts);
        const docQr = docs.map((d) => d.extracted as S["docQr"]).find((x) => x?.cnic) ?? null;
        return { docEvidence: evidence, docQr, reusedImage: reuse.length > 0, reuseDetail: reuse, injection };
      },
    },
    {
      name: "duplicates",
      consent: ["identity.read"],
      run: async (st) => {
        const cz = st.citizen!;
        const cnic = st.claim?.cnic ?? cz.cnic ?? st.docQr?.cnic ?? null;
        const pool = await db
          .select()
          .from(citizens)
          .where(and(eq(citizens.tenantId, c.tenantId), ne(citizens.id, c.citizenId)))
          .limit(5000);
        const dups = findDuplicateCandidates({ id: cz.id, fullName: cz.fullName, fatherName: st.claim?.fatherName ?? cz.fatherName, cnic, dob: st.claim?.dob ?? cz.dob }, pool);
        return { duplicates: dups.map((d) => ({ id: d.id, reason: d.reason })) };
      },
    },
    {
      name: "payout_account",
      run: async (st) => {
        const alias = st.citizen!.payoutAlias;
        const recent = await db
          .select()
          .from(payoutAliasChanges)
          .where(and(eq(payoutAliasChanges.citizenId, c.citizenId), or(inArray(payoutAliasChanges.status, ["pending_officer", "cooling_off", "frozen"]), sql`${payoutAliasChanges.effectiveAt} > now() - interval '7 days'`)));
        const shared = alias ? await db.select({ id: citizens.id }).from(citizens).where(and(eq(citizens.payoutAlias, alias), ne(citizens.id, c.citizenId))) : [];
        return { payoutAccount: { changedRecently: recent.length > 0, sharedWith: shared.map((s) => s.id) } };
      },
    },
    {
      name: "advisory_signals",
      timeoutMs: 20_000,
      run: async (st) => {
        const docIncome = st.docQr?.monthlyIncome ?? null;
        const summary = {
          documentsPresent: !!st.docEvidence?.some((d) => d.kind === "cnic" && d.readable) && !!st.docEvidence?.some((d) => d.kind === "income_proof" && d.readable),
          incomeStated: (st.claim?.monthlyIncome as number | undefined) ?? null,
          incomeOnRecord: st.income?.monthlyIncome ?? null,
          incomeOnDocument: docIncome,
          nameVariants: [st.claim?.fullName ?? st.citizen!.fullName, st.registry?.fullName, st.docQr?.fullName].filter((x): x is string => !!x),
          dobValues: [st.claim?.dob ?? st.citizen!.dob ?? st.docQr?.dob, st.registry?.dob].filter((x): x is string => !!x),
          householdSizes: [st.claim?.householdSize as number | undefined, st.income?.householdSize].filter((x): x is number => typeof x === "number"),
        };
        const r = await caseSignals(summary);
        return { signals: r.signals, signalsMeta: { ...r.meta, summary } };
      },
    },
    {
      name: "calibrated_score",
      run: async (st) => {
        const model = await activeScoringModel(db);
        if (!model) return { calibrated: null };
        const input = buildInput(st, { ok: true, missingScopes: [] });
        const r = calibratedP(model, input);
        return { calibrated: { ...r, modelVersion: model.version } };
      },
    },
  ];

  function buildInput(st: S, consent: { ok: boolean; missingScopes: string[] }): DecisionInput {
    const claim = st.claim ?? {};
    const cz = st.citizen!;
    const identityClaim = {
      fullName: claim.fullName ?? cz.fullName,
      fatherName: claim.fatherName ?? cz.fatherName ?? st.docQr?.fatherName ?? null,
      cnic: claim.cnic ?? cz.cnic ?? st.docQr?.cnic ?? null,
      dob: claim.dob ?? cz.dob ?? st.docQr?.dob ?? null,
    };
    const registry = st.registry ?? null;
    let identity: IdentityMatch = matchIdentity(identityClaim, registry ? { fullName: registry.fullName, fatherName: registry.fatherName, cnic: registry.cnic, dob: registry.dob } : null);
    // The registry was unreachable: we cannot say "not in registry" — that would be a guess.
    if (!registry && st.registryUnavailable.includes("nadra") && identity.verdict === "no_record") identity = { verdict: "insufficient", score: 0, evidence: [{ check: "cnic", result: "unknown", detail: "Identity registry unavailable" }] };
    const facts: Facts = {
      monthly_income: st.income?.monthlyIncome ?? st.docQr?.monthlyIncome ?? null,
      household_size: st.income?.householdSize ?? (claim.householdSize as number | null) ?? null,
      age: ageFrom(registry?.dob ?? identityClaim.dob),
      marital_status: registry?.maritalStatus ?? (claim.maritalStatus as string | null) ?? null,
      gender: registry?.gender ?? cz.gender ?? null,
      district: registry?.district ?? cz.district ?? null,
      alive: registry ? registry.alive : null,
      has_valid_cnic: !!normalizeCnic(identityClaim.cnic),
      recent_payment_days: (st as S & { recentPaymentDays?: number }).recentPaymentDays ?? 99999,
    };
    return {
      ruleSet: { id: ruleSet.id, version: ruleSet.version, definition: ruleSet.definition },
      facts,
      factSources: {
        monthly_income: st.income ? "mock_income_registry" : st.docQr?.monthlyIncome ? "document" : st.registryUnavailable.includes("income") ? "registry_unavailable" : "missing",
        household_size: st.income ? "mock_income_registry" : claim.householdSize ? "applicant_statement" : "missing",
        age: registry ? "mock_nadra" : identityClaim.dob ? "applicant_statement" : "missing",
        alive: registry ? "mock_nadra" : "missing",
        recent_payment_days: "payout_ledger",
      },
      identity,
      documents: st.docEvidence ?? [],
      duplicates: st.duplicates ?? [],
      consent,
      signals: st.signals ?? [],
      amountRequested: c.amountRequested,
      identityAmbiguous: !!st.search?.ambiguous,
      reusedImage: !!st.reusedImage,
      injection: st.injection ?? { found: false, matches: [] },
      payoutAccount: st.payoutAccount ?? { changedRecently: false, sharedWith: [] },
      registryUnavailable: st.registryUnavailable,
      calibrated: st.calibrated ?? null,
    };
  }

  const initial: S = { caseId, registryUnavailable: [], ...({ recentPaymentDays: await recentPaymentDays(db, c.citizenId, caseId) } as object) } as S;
  const result = await runPipeline<S>(db, {
    kind: "decision",
    tenantId: c.tenantId,
    caseId,
    citizenId: c.citizenId,
    trigger: opts.trigger,
    actor: ai,
    steps,
    initial,
    resumeRunId: opts.resumeRunId,
    onHalt: async (_st, _reason, step) => ({ consentMissing: [step] }),
  });
  const st = result.state;
  if (!st.citizen) {
    const [cz] = await db.select().from(citizens).where(eq(citizens.id, c.citizenId));
    st.citizen = { id: cz!.id, fullName: cz!.fullName, fatherName: cz!.fatherName, cnic: cz!.cnic, dob: cz!.dob, gender: cz!.gender, district: cz!.district, payoutAlias: cz!.payoutAlias, tenantId: cz!.tenantId };
    st.claim = c.claim as ClaimInput;
  }
  const consent = result.status === "halted" ? { ok: false, missingScopes: [result.haltReason ?? "consent"] } : { ok: true, missingScopes: [] };
  const input = buildInput(st, consent);
  const out = decide(input);
  return persistDecision(db, { c, ai, ruleSet, input, out, st, runId: result.runId, pipelineStatus: result.status, steps: result.steps, trigger: opts.trigger, requestId: opts.requestId });
}

async function persistDecision(
  db: DB,
  a: {
    c: typeof cases.$inferSelect;
    ai: Actor;
    ruleSet: Awaited<ReturnType<typeof activeRuleSet>>;
    input: DecisionInput;
    out: DecisionOutput;
    st: S;
    runId: string;
    pipelineStatus: string;
    steps: unknown;
    trigger: string;
    requestId?: string;
  },
) {
  const { c, ai, ruleSet, input, out, st } = a;
  const th = ruleSet.definition.thresholds;
  const urg = await urgencyAndKind([String(st.claim?.statement ?? ""), out.lane === "human" ? "needs human review" : ""].join(" "));
  await recordAiDecision(db, {
    tenantId: c.tenantId,
    kind: "routing",
    subjectType: "case",
    subjectId: c.id,
    citizenId: c.citizenId,
    input: { text: [String(st.claim?.statement ?? ""), out.lane === "human" ? "needs human review" : ""].join(" ") },
    output: { urgency: urg.urgency, kind: urg.kind, meta: urg.meta },
    citizenView: { en: "Your case was placed in the review queue.", ur: "آپ کا کیس جائزے کی قطار میں رکھ دیا گیا ہے۔" },
    model: urg.meta,
  });
  if (st.signals?.length) {
    await recordAiDecision(db, {
      tenantId: c.tenantId,
      kind: "case_signals",
      subjectType: "case",
      subjectId: c.id,
      citizenId: c.citizenId,
      input: (st.signalsMeta as { summary?: unknown } | undefined)?.summary ?? { note: "summary not stored" },
      output: { signals: st.signals, meta: st.signalsMeta },
      citizenView: { en: "Your documents and records were compared.", ur: "آپ کے کاغذات اور ریکارڈ کا موازنہ کیا گیا۔" },
      model: st.signalsMeta ?? null,
    });
  }
  const priority = Math.round(Math.min(100, (out.lane === "human" ? 40 : out.lane === "ask_proof" ? 20 : 10) + urg.urgency * 40 + (out.hardStops.length ? 15 : 0) + (1 - out.score) * 10));
  const { ruleSet: _rs, ...inputWithoutRules } = input;
  void _rs;
  const trace = {
    trigger: a.trigger,
    pipeline: { runId: a.runId, status: a.pipelineStatus, steps: a.steps },
    input: inputWithoutRules,
    output: { ...out, userReason: undefined },
    hardStops: out.hardStopIds.map((id, i) => `${id} ${out.hardStops[i]}`),
    weights: { identity: 0.4, documents: 0.35, eligibilityEvidence: 0.25 },
    thresholds: ruleSet.definition.thresholds,
    autoApprove: out.autoApprove,
    fastLaneEnabled: ruleSet.definition.fastLaneEnabled,
    identitySearch: st.search ?? null,
    imageReuse: st.reuseDetail ?? null,
  };
  const modelInfo = {
    caseSignals: st.signalsMeta ?? null,
    urgency: urg.meta,
    calibratedScorer: st.calibrated ? { type: "logistic+isotonic", version: st.calibrated.modelVersion, trainedOn: "frozen synthetic benchmark (not real-world accuracy)" } : null,
    decisionEngine: "asli-decision@3 (deterministic policy + escalate-only advisory layer)",
    identityMatcher: "asli-names@2 (deterministic + Fellegi–Sunter search)",
  };
  const decisionId = newId("dcs");
  await db.insert(decisions).values({
    id: decisionId,
    caseId: c.id,
    tenantId: c.tenantId,
    ruleSetId: ruleSet.id,
    ruleVersion: ruleSet.version,
    lane: out.lane,
    eligible: out.eligible,
    score: out.score,
    reasonCodes: out.reasonCodes,
    hardStops: out.hardStops,
    userReason: { en: out.userReason.en, ur: out.userReason.ur },
    counterfactuals: out.counterfactuals,
    trace,
    modelInfo,
    inputHash: sha256Hex(canonicalJson(inputWithoutRules)),
  });

  let status: CaseStatus = "in_review";
  let proofDeadline: Date | null = null;
  if (out.lane === "ask_proof") {
    status = "needs_proof";
    proofDeadline = new Date(Date.now() + th.proofDeadlineHours * 3600_000);
  } else if (out.lane === "auto") status = "approved";
  await db.update(cases).set({ status, lane: out.lane, confidence: out.calibratedP ?? out.score, priority, proofRequested: out.lane === "ask_proof" ? out.proofItems : null, proofDeadline, updatedAt: new Date() }).where(eq(cases.id, c.id));

  // Any earlier provisional reservation is cancelled if the new decision is not "auto" (new contradictory evidence).
  const [existingPayout] = await db.select().from(payouts).where(eq(payouts.caseId, c.id));
  let provisional: { payoutId: string; amount: number; coolingOffUntil: Date } | null = null;
  if (existingPayout && existingPayout.status === "reserved" && out.lane !== "auto") {
    await db.update(payouts).set({ status: "cancelled", cancelledReason: `New decision ${decisionId} lane ${out.lane}` }).where(eq(payouts.id, existingPayout.id));
    await audit(db, { actor: ai, action: "payout.reservation_cancelled", targetType: "payout", targetId: existingPayout.id, detail: { reason: "new evidence", decisionId, lane: out.lane }, tenantId: c.tenantId });
  }
  if (out.lane === "auto" && (!existingPayout || existingPayout.status === "cancelled")) {
    const cooling = new Date(Date.now() + out.autoApprove.coolingOffHours * 3600_000);
    const payoutId = existingPayout?.id ?? newId("pay");
    const values = {
      tenantId: c.tenantId,
      caseId: c.id,
      citizenId: c.citizenId,
      amount: out.benefitAmount,
      alias: st.citizen?.payoutAlias ?? "",
      requiredApprovals: out.benefitAmount > th.secondApproverAbovePKR ? 2 : 1,
      approvals: [],
      status: "reserved" as const,
      provisional: true,
      coolingOffUntil: cooling,
      cancelledReason: null,
      createdBy: ai.id,
    };
    if (existingPayout) await db.update(payouts).set(values).where(eq(payouts.id, payoutId));
    else await db.insert(payouts).values({ id: payoutId, ...values });
    await enqueueJob(db, "payout.cooling_off_end", { payoutId }, cooling);
    provisional = { payoutId, amount: out.benefitAmount, coolingOffUntil: cooling };
    await audit(db, { actor: ai, action: "payout.reserved_provisionally", targetType: "payout", targetId: payoutId, detail: { amount: out.benefitAmount, coolingOffUntil: cooling.toISOString(), calibratedP: out.calibratedP, threshold: out.autoApprove.threshold, movedMoney: false }, tenantId: c.tenantId });
  }

  if (out.lane === "human") {
    await db.insert(caseNotes).values({
      id: newId("nte"),
      caseId: c.id,
      authorType: "ai",
      authorId: ai.id,
      kind: "handoff",
      body: `I am not sure — handing to a human. ${out.hardStopIds.length ? `Hard stops: ${out.hardStopIds.map((id, i) => `${id} ${out.hardStops[i]}`).join(", ")}. ` : ""}Reasons: ${out.reasonCodes.join(", ")}. Evidence score ${out.score}${out.calibratedP !== null ? `, calibrated p ${out.calibratedP}` : ""}. Identity: ${input.identity.verdict}.${out.modelAdjustments.length ? ` Advisory escalations: ${out.modelAdjustments.map((m) => `${m.source} ${m.from}→${m.to}`).join("; ")}.` : ""}${st.consentMissing ? " Consent was missing/withdrawn during processing; no further data was read." : ""}`,
      data: { decisionId, hardStops: out.hardStops.map(label), reasonCodes: out.reasonCodes, identity: input.identity, duplicates: input.duplicates, injection: input.injection, registryUnavailable: input.registryUnavailable },
    });
    if (input.registryUnavailable?.length) await enqueueJob(db, "case.redecide", { caseId: c.id, reason: "registry_unavailable" }, new Date(Date.now() + 10 * 60_000));
  }
  if (out.lane === "ask_proof") {
    await db.insert(caseNotes).values({ id: newId("nte"), caseId: c.id, authorType: "ai", authorId: ai.id, kind: "proof_request", body: `Asked for: ${out.proofItems.join(", ")}. Deadline ${proofDeadline!.toISOString()}; escalates to a human if not supplied.`, data: { decisionId } });
    await enqueueJob(db, "case.proof_deadline", { caseId: c.id, decisionId }, proofDeadline!);
  }
  const notice = await issueNotice(db, { tenantId: c.tenantId, caseId: c.id, citizenId: c.citizenId, type: out.lane === "ask_proof" ? "proof_requested" : "decision", amount: out.lane === "auto" ? out.benefitAmount : null });
  const aid = await recordAiDecision(db, {
    tenantId: c.tenantId,
    kind: "case_decision",
    subjectType: "case",
    subjectId: c.id,
    citizenId: c.citizenId,
    input: { ruleSetId: ruleSet.id, ...inputWithoutRules },
    output: out,
    citizenView: { reason: out.userReason, counterfactuals: out.counterfactuals, lane: out.lane, nothingPaidYet: true },
    auditorView: trace,
    model: modelInfo,
  });
  await audit(db, {
    actor: ai,
    action: "decision.made",
    targetType: "case",
    targetId: c.id,
    detail: { decisionId, aiDecisionId: aid, lane: out.lane, policyLane: out.policyLane, score: out.score, calibratedP: out.calibratedP, eligible: out.eligible, ruleVersion: ruleSet.version, hardStops: out.hardStops, pipeline: a.pipelineStatus },
    tenantId: c.tenantId,
    requestId: a.requestId,
  });
  await emit(db, c.tenantId, out.lane === "ask_proof" ? "case.needs_proof" : "case.decided", { caseId: c.id, decisionId, lane: out.lane, ruleVersion: ruleSet.version });

  return {
    id: decisionId,
    aiDecisionId: aid,
    lane: out.lane,
    policyLane: out.policyLane,
    status,
    eligible: out.eligible,
    score: out.score,
    calibratedP: out.calibratedP,
    ruleVersion: ruleSet.version,
    proofItems: out.proofItems,
    proofDeadline,
    userReason: out.userReason,
    counterfactuals: out.counterfactuals,
    reasonCodes: out.reasonCodes,
    hardStops: out.hardStopIds.map((id, i) => `${id} ${out.hardStops[i]}`),
    modelAdjustments: out.modelAdjustments,
    autoApprove: out.autoApprove,
    provisional,
    benefitAmount: out.benefitAmount,
    pipeline: { runId: a.runId, status: a.pipelineStatus },
    notice: { code: notice.code, spokenCode: notice.spokenCode },
  };
}

// ───────────── jobs ─────────────

registerJob("case.proof_deadline", async (db, payload) => {
  const c = (await db.select().from(cases).where(eq(cases.id, String(payload.caseId))))[0];
  if (!c || c.status !== "needs_proof") return;
  const system: Actor = { type: "system", id: "deadline-timer", tenantId: c.tenantId, role: "system" };
  await db.update(cases).set({ status: "in_review", lane: "human", priority: Math.max(c.priority, 60), updatedAt: new Date() }).where(eq(cases.id, c.id));
  await db.insert(caseNotes).values({ id: newId("nte"), caseId: c.id, authorType: "system", authorId: system.id, kind: "handoff", body: "Proof deadline passed without the requested items. Escalated to a human — never auto-rejected.", data: { requested: c.proofRequested } });
  await audit(db, { actor: system, action: "case.escalated", targetType: "case", targetId: c.id, detail: { reason: "PROOF_DEADLINE_PASSED" }, tenantId: c.tenantId });
  await emit(db, c.tenantId, "case.escalated", { caseId: c.id, reason: "PROOF_DEADLINE_PASSED" });
});

registerJob("case.redecide", async (db, payload) => {
  const c = (await db.select().from(cases).where(eq(cases.id, String(payload.caseId))))[0];
  if (!c || !["in_review", "submitted"].includes(c.status)) return;
  await runDecision(db, c.id, { trigger: `retry:${payload.reason}` });
});

registerJob("pipeline.resume", async (db, payload) => {
  const { pipelineRuns } = await import("../db/schema");
  const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, String(payload.runId)));
  if (!run || run.status !== "running") return;
  if (Date.now() - run.updatedAt.getTime() < 90_000) {
    await enqueueJob(db, "pipeline.resume", payload, new Date(Date.now() + 120_000));
    return;
  }
  await runDecision(db, run.caseId, { trigger: "resume", resumeRunId: run.id });
});

/** Cooling-off over: the reservation becomes a payout awaiting ONE-TAP HUMAN release (AI never releases). */
registerJob("payout.cooling_off_end", async (db, payload) => {
  const [p] = await db.select().from(payouts).where(eq(payouts.id, String(payload.payoutId)));
  if (!p || p.status !== "reserved") return;
  await db.update(payouts).set({ status: "pending_approval" }).where(eq(payouts.id, p.id));
  const system: Actor = { type: "system", id: "cooling-off-timer", tenantId: p.tenantId, role: "system" };
  await audit(db, { actor: system, action: "payout.cooling_off_ended", targetType: "payout", targetId: p.id, detail: { amount: p.amount, nextStep: "human release" }, tenantId: p.tenantId });
  await notifyUser(db, { tenantId: p.tenantId, userId: null, citizenId: p.citizenId, title: "payout.ready_for_release", body: t("lane.fast") });
});

export { sql };
