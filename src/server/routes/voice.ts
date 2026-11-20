import { router, route, z, body, actx } from "../http/route";
import { transcribe, speechAvailable } from "../ai/speech";
import { extractClaim } from "../ai/claude";
import { askPolicy } from "../services/rag";
import { ivrStart, ivrInput } from "../services/ivr";
import { createCase } from "../services/cases";
import { getActor, ipKey } from "../http/middleware";
import { audit } from "../lib/audit";
import { AppError, badRequest } from "../lib/errors";
import { rateLimit } from "../http/ratelimit";
import { t } from "../lib/i18n";

export const voiceRoutes = router();

const Intake = z
  .object({
    audioBase64: z.string().optional().openapi({ description: "Recorded answer (webm/ogg/mp3/wav), max ~10 MB" }),
    mime: z.string().default("audio/webm"),
    transcript: z.string().max(4000).optional().openapi({ description: "Use when audio was transcribed on-device or offline" }),
    language: z.enum(["ur", "en", "pa", "sd", "ps"]).default("ur"),
    createDraft: z.boolean().default(false).openapi({ description: "Also create a draft case from the extracted fields" }),
    clientRef: z.string().optional(),
  })
  .openapi("VoiceIntake");
voiceRoutes.openapi(
  route({
    method: "post",
    path: "/voice/intake",
    tags: ["Voice"],
    summary: "Speak instead of filling a form: speech → text (Whisper) → validated claim fields (Claude) → confirmation prompt",
    description: "Fields the speaker did not say clearly come back null and listed in unclearFields — the app asks again instead of guessing.",
    body: Intake,
  }),
  async (c) => {
    const b = body(c, Intake);
    const actor = getActor(c);
    let transcript = b.transcript ?? null;
    let stt: unknown = { provider: "client" };
    if (b.audioBase64) {
      if (!speechAvailable() && !transcript) throw new AppError(503, "SPEECH_UNAVAILABLE", "Speech-to-text is not configured here; send a transcript (e.g. from on-device recognition).");
      if (speechAvailable()) {
        const r = await transcribe(Buffer.from(b.audioBase64, "base64"), b.mime, `answer.${b.mime.split("/")[1] ?? "webm"}`, b.language);
        transcript = r?.text ?? transcript;
        stt = r;
      }
    }
    if (!transcript) throw badRequest("NO_SPEECH", "Send audioBase64 or transcript");
    const { data, meta } = await extractClaim(transcript);
    await audit(c.get("db"), { actor: { type: "ai", id: "asli-intake", tenantId: actor.tenantId, role: "ai" }, action: "voice.intake", detail: { stt, extractor: meta, unclear: data.unclearFields }, requestId: c.get("requestId") });
    let draftCaseId: string | null = null;
    if (b.createDraft && data.requestType === "relief_claim") {
      const { case: row } = await createCase(c.get("db"), actx(c), {
        claim: { fullName: data.fullName, fatherName: data.fatherName, cnic: data.cnic, dob: data.dob, maritalStatus: data.maritalStatus, householdSize: data.householdSize, monthlyIncome: data.monthlyIncome, district: data.district, phone: data.phone, statement: transcript },
        clientRef: b.clientRef,
        createdVia: "voice",
      });
      draftCaseId = row.id;
    }
    const heard = [data.fullName && `name ${data.fullName}`, data.cnic && `ID ${data.cnic}`, data.monthlyIncome && `income Rs ${data.monthlyIncome}`, data.householdSize && `${data.householdSize} people at home`].filter(Boolean).join(", ");
    const heardUr = [data.fullName && `نام ${data.fullName}`, data.cnic && `شناختی نمبر ${data.cnic}`, data.monthlyIncome && `آمدنی ${data.monthlyIncome} روپے`, data.householdSize && `گھر میں ${data.householdSize} افراد`].filter(Boolean).join("، ");
    return c.json(
      {
        transcript,
        fields: data,
        extractor: meta,
        draftCaseId,
        confirm: {
          en: heard ? `I heard: ${heard}. Is this right? Say yes or no.` : "I could not understand. Please say it again slowly.",
          ur: heardUr ? `میں نے سنا: ${heardUr}۔ کیا یہ درست ہے؟ ہاں یا نہیں کہیں۔` : "میں سمجھ نہیں سکی۔ براہ کرم آہستہ دوبارہ بولیں۔",
          audioKey: heard ? null : "voice.repeat",
        },
        askAgainFor: data.unclearFields,
      },
      200,
    );
  },
);

const Ask = z.object({ question: z.string().min(2).max(1000) }).openapi("PolicyQuestion");
voiceRoutes.openapi(
  route({ method: "post", path: "/policy/ask", tags: ["Policy (RAG)"], summary: "Ask about the rules — answered only from official (mock) policy, with sources; says 'not sure' otherwise", body: Ask, auth: false }),
  async (c) => {
    const rl = rateLimit(`ask:${c.get("actor")?.id ?? ipKey(c)}`, 30, 60_000);
    if (!rl.ok) throw new AppError(429, "RATE_LIMITED", "Too many questions; try again in a minute.");
    return c.json(await askPolicy(body(c, Ask).question), 200);
  },
);

voiceRoutes.openapi(route({ method: "get", path: "/voice/clips", tags: ["Voice"], summary: "Fixed spoken prompts (en/ur) by audio key — pre-record or cache these for 2G", auth: false }), async (c) => {
  const keys = ["lane.fast", "lane.human", "verify.genuine", "verify.scam", "verify.tampered", "verify.not_linked", "verify.suspicious", "consent.withdrawn", "handoff.created", "appeal.received", "ivr.welcome", "ivr.enter_code", "ivr.callback", "proof.retake_photo"] as const;
  return c.json({ clips: keys.map((k) => t(k as never)) }, 200);
});

// ───────── IVR (simulated telephony) ─────────

const Call = z.object({ phone: z.string().min(10).openapi({ example: "03001234567" }) }).openapi("IvrCall");
voiceRoutes.openapi(route({ method: "post", path: "/ivr/calls", tags: ["Feature-phone line"], summary: "Missed call → callback starts; returns the first spoken menu", body: Call, auth: false, status: 201 }), async (c) => {
  return c.json(await ivrStart(c.get("db"), body(c, Call).phone), 201);
});

const Keys = z.object({ digits: z.string().regex(/^[0-9*#]{1,8}$/) }).openapi("IvrInput");
voiceRoutes.openapi(route({ method: "post", path: "/ivr/calls/{id}/input", tags: ["Feature-phone line"], summary: "Keypad input (1 status, 2 check a message code, 3 talk to a person)", params: z.object({ id: z.string().openapi({ param: { name: "id", in: "path" } }) }), body: Keys, auth: false }), async (c) => {
  return c.json(await ivrInput(c.get("db"), c.req.param("id") ?? "", body(c, Keys).digits), 200);
});
