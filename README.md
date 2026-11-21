# Asli — trust infrastructure for relief payments

> **PROTOTYPE ONLY — not an official government service.** All identity (NADRA), payment (Raast) and registry data is **simulated**. No real personal data is used anywhere.

Coder's Cup 2026 · AI Hackathon · *The Last Mile: AI on Public Rails* · ACM NUCES / FAST-NUCES Karachi

**We help a widow who cannot read claim and safely receive a relief payment, even though she can't read the form, her signal drops, her name is spelled three ways across records, and scammers send her fake "relief" messages.**

The application is the workflow; **trust is the product**:

1. **Signed Truth** — every real message Asli sends is Ed25519-signed and bound to the case, the person, the amount and an expiry, with a 4-digit code that can be spoken. Anyone (widow, helper, shopkeeper) can forward a "relief payment" message and Asli checks it against the **case ledger and the mock Raast ledger first**, and only then classifies the text. Edit one digit of a real message and verification fails.
2. **Thresholds from data, not guesses** — the fast / ask-for-proof / human cut-offs are fitted on 200 labelled synthetic cases by minimising expected cost, reported on a held-out split, with false alarms shown.
3. **AI never moves money** — the AI can only pre-verify. Every payout needs a human officer; above Rs 10,000 a *different* officer must also approve. The agent's attempt to pay returns `403 AI_CANNOT_INITIATE_PAYMENT` and is logged.

---

## What is real and what is simulated

| Real (working code) | Simulated |
| --- | --- |
| Auth (JWT), roles, server-side RBAC, consent checks on every request | NADRA identity registry (`mock_nadra` table) |
| Case lifecycle, decision engine, versioned rules, Digital Twin | Income/social registry (`mock_income`) |
| Ed25519 signing + verification, spoken codes, ledger checks | Raast payments (`mock_raast_ledger`) |
| Hash-chained append-only audit log | SMS / WhatsApp / IVR gateways (we record "sent"; IVR runs as an API state machine) |
| Document checks: blur (Laplacian), signed-QR decode + verify, tamper score | Mock CNIC cards (generated, clearly labelled "NOT A REAL DOCUMENT") |
| Claude (extraction, CNIC reading, policy answers), Jev (classification/routing), Whisper (Urdu speech) — **when API keys are set** | Without keys: deterministic fallbacks, and every trace records which one ran |
| Webhooks (HMAC), background jobs, rate limits, plans, API keys, OpenAPI | Cost figures in the evaluation (prototype assumptions, labelled) |

## What changed in v3 (after comparing notes with ChatGPT, DeepSeek and Perplexity)

| Area | v3 |
| --- | --- |
| Acting alone | **Provisional auto-approve lane**: the system may approve a claim alone when the calibrated score ≥ `max(0.90, (W·m − R)/(W·m + D))` and the amount ≤ cap — but money is only **reserved**, there is a 24 h cooling-off, the citizen or an officer can cancel, and release still needs a human. AI still never moves money. |
| Hard stops | 12 named stops **S1–S12** (`GET /api/v1/hard-stops`), each with a golden test |
| Models | **Escalate-only**: Jev / LLM / classifier signals can add caution, never remove it (invariant + 1,000-trial property test) |
| Calibration | Logistic regression + isotonic on a frozen 300/100/100 split by scenario; ECE 0.146 → ~0.076; never claims certainty; empirical cost minimum shown beside the formula threshold |
| Identity | Fellegi–Sunter registry search with review zone and **ambiguity stop** (top two within 2 bits); a CNIC typo never verifies |
| Consent | Re-checked **before every pipeline step** — withdrawal mid-run halts it; auditor traces lose personal fields after withdrawal |
| Audit | Hash chain **inside Postgres** (trigger); updates/deletes blocked; `audit_verify()` names the first broken row and detects deleted rows |
| Explain | **Every** AI judgement (case decisions, scam verdicts, routing, signals, policy answers, extractions) has a citizen view, an auditor view and **replay** |
| Platform | 404 across departments, RFC 9457 errors, IETF RateLimit headers, Idempotency-Key required on money endpoints, chaos panel + circuit breaker, durable resumable pipeline, break-glass with a 15-minute window |
| Last metre | Payout-account change: PIN → officer (not the requester) → 48 h cooling-off → **press 9** from the old number freezes it; exact-amount receipts ("received less" opens a complaint linked to the helper); complaint & correction queue; helper anomaly rules |
| Honesty | Six frozen datasets with sha256 manifest; **Break It**: 18 attacks + 8 legitimate controls (18/18 caught, 8/8 pass); generated permission matrix (102 endpoints × 11 actors) and curl examples |

Docs: [compliance matrix](docs/COMPLIANCE.md) · [stated limits & trust critique](docs/LIMITS.md) · [cut order & gates](docs/CUT-ORDER.md) · [permission matrix](docs/permission-matrix.md) · [curl examples](docs/curl-examples.md) · [error codes](docs/ERRORS.md) · [dataset spec](datasets/SPEC.md)

## How the decision works (Challenges 01, 02, 05)

Evidence score (transparent, **not** a probability):

```
S = 0.40·Identity + 0.35·Documents + 0.25·(share of eligibility facts known)
```

| Lane | When | What happens |
| --- | --- | --- |
| **fast** | every rule passes, identity verified, documents clean, no uncertain classifier signal, S ≥ cut-off | Goes to an officer as a one-tap approval. **Nothing is paid yet.** |
| **ask_proof** | a gap the citizen can close (blurry photo, missing income proof, name variant needing father's name) | Spoken request for the exact item; 72-hour deadline; then **escalates to a human — never auto-rejected** |
| **human** ("I am not sure") | hard stop (identity conflict, forgery signal, duplicate suspected, deceased in registry, consent missing), a failed rule, low evidence, or a Jev answer in the 0.35–0.65 band | Stops; officer gets case notes with every failed check |

**Why AI never pays alone:** with a wrong approval costing PKR 50,000 and a review PKR 500, acting alone only wins if P(correct) > 99%. With *n* clean test cases and zero errors, the 95% upper bound on the error rate is ≈ 3/*n*, so proving < 1% needs 300+ cases with zero mistakes. A hackathon cannot show that, so Asli doesn't claim it. `POST /api/v1/eval/runs` shows the arithmetic.

Every decision stores: rule set id + **version**, input hash, every fact and its source, identity evidence, document checks, classifier source (Jev / heuristic), model + prompt versions, the simple Urdu/English reason, and **counterfactuals** ("If proof shows your income is Rs 40,000 or less, you would qualify").

## Feature map (brief → implementation)

| Brief requirement | Where |
| --- | --- |
| JWT + RBAC (5 roles: citizen, helper, officer, admin, auditor) | `src/server/http/middleware.ts`, `src/server/services/access.ts` |
| Dashboard data, case management (create, assign, escalate, close) | `/v1/cases*`, `/v1/officer/queue`, `/v1/analytics` |
| Public REST API + API keys + OpenAPI | `/api/docs` (Swagger UI), `/api/openapi.json`, `X-API-Key` with scopes |
| Audit log of every user / AI / agent action (tamper-evident) | `src/server/lib/audit.ts`, `/v1/audit`, `/v1/audit/verify` |
| Consent: see, share, withdraw, correct | `/v1/consent*` — withdrawal checked live; next call returns `403 CONSENT_REVOKED` |
| Mock identity / payment / data services behind clean APIs | `src/server/services/mockdpi.ts`, `/v1/citizens/{id}/registry` |
| **Platform extras** | multi-tenant departments · admin rule editor · notifications (in-app + mock SMS) · webhooks · analytics per tenant · officer queue by priority & confidence · subscription plans & usage limits · background jobs · rate limiting · offline sync |
| **AI features** | Jev classification & routing · Claude structured outputs · computer vision (blur, signed QR, vision read, tamper) · Urdu voice (Whisper) · policy RAG with sources · agent with tool calls + guardrails · explainability + counterfactuals · anomaly detection · evaluation dashboard · memory (case history across sessions) |
| Bonus: Digital Twin | `POST /v1/rules/{id}/simulate` — who flips, money delta, extra human load |
| Bonus: Helper Mode | `/v1/helper/*` — PIN switch, 20-min family token, per-family consent, 5-try lockout |
| Bonus: Offline-first sync | `POST /v1/sync` — ordered outbox, opId idempotency, clientRef mapping |
| Bonus: Scam Map | `/v1/scam-map`, `/v1/scam-map/public` — by district/category/day + spike alerts |
| Unique: "Try to fool Asli" | `/v1/redteam/*` — 11 one-tap attacks through the real code paths |
| Unique: Prove, don't share | `/v1/citizens/{id}/attestations` — signed yes/no instead of data; officers see masked data unless break-glass (logged) |
| Unique: Feature-phone line | `/v1/ivr/*` — missed call → Urdu menu: status / check a code / talk to a person |
| Unique: Drift guard + kill switch | `/v1/drift/check`, `/v1/rules/fast-lane` |
| Unique: Public transparency | `/v1/transparency` — including false alarms and share sent to humans |

## Run it locally

Requirements: Node 20+.

```bash
npm install
cp .env.example .env        # all AI keys optional
npm run db:seed             # embedded Postgres (PGlite) in .data/, seeded via the REAL flows
npm run dev                 # http://localhost:3000  → API docs at /api/docs
npm test                    # 73 tests: golden hard stops, property tests, end-to-end API (in-memory DB)
npm run matrix              # regenerate docs/permission-matrix.md + docs/curl-examples.md
npm run scorer:train        # retrain the calibrated scorer on frozen D1
npm run datasets:freeze     # rewrite datasets/*.json + manifest (only if the generators change)
npm run eval:run            # fit thresholds on synthetic cases, print the honest numbers
```

Demo accounts are created by `npm run db:seed`; the emails, shared demo password and family PIN are in `src/server/demo/seed.ts` (`DEMO_PASSWORD`, `DEMO_PIN`) and printed by the seed script. They are prototype test values only.

| Account | Role | Use it to show |
| --- | --- | --- |
| `fatima@asli.demo` | citizen (the widow) | her paid case, spoken reasons, consent dashboard, verifying a message |
| `shopkeeper@asli.demo` | citizen (shopkeeper) | forwarding scam messages; over-income case → human with counterfactual |
| `helper@asli.demo` | community helper | 5 families on one phone; PIN switch; withdrawal stops access |
| `officer@asli.demo`, `officer2@asli.demo` | officers (second has second-approver right) | queue, approvals, two-person payout, scam review |
| `admin@asli.demo` | admin | rules, Digital Twin, kill switch, API keys, webhooks, red team |
| `auditor@asli.demo` | auditor | read-only audit log, chain verification, decision traces |
| `officer@sindh.demo` | officer, other department | cross-department access is refused |

### Seeded scenarios (all produced by the real decision engine)

| Person | What happens |
| --- | --- |
| Fatima Bibi | record had no CNIC; the signed QR on her ID photo fills it; "Fatimah"/"Fatima" and "Allah Ditta"/"Allah Dita" still verify → fast lane → officer + second approver → mock Raast → signed payment notice |
| Zainab Begum | blurry income proof → ask_proof: "a new photo — hold the phone steady" |
| Mohammad Aslam | same father & DOB as Muhammad Aslam, different CNIC → DUPLICATE_SUSPECTED → human |
| Shahida Parveen | CNIC QR edited after signing → FORGERY_SIGNAL → human |
| Khadija Bibi | clean → fast lane, waiting for one-tap approval |
| Imran (shopkeeper) | income above the limit → human, with "if your income were ≤ Rs 40,000…" |
| Scam reports | 7 forwarded messages across 5 districts; one later marked a **false alarm** and counted publicly |

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres / Supabase. Empty → embedded PGlite (`ASLI_DB=file|memory`) |
| `JWT_SECRET` | sign access tokens |
| `ASLI_AI_MODE` | `live` (use keys if present) or `offline` (deterministic fallbacks only) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude (default `claude-opus-5-5`, with server-side refusal fallback) |
| `AI_GATEWAY_API_KEY` or `OPENROUTER_API_KEY` | Jev (`typesafe-ai/jev` / `typesafe/jev-1.14`) |
| `GROQ_API_KEY` or `OPENAI_API_KEY` | Whisper speech-to-text for Urdu |
| `SIGNING_PRIVATE_KEY`, `SIGNING_PUBLIC_KEY` | Ed25519 keys (`npm run keys:generate`); dev auto-generates one |
| `CRON_SECRET` | protects `/api/cron/jobs` |
| `ASLI_DEMO_MODE` | `true` enables `GET /api/v1/demo/tokens` (fictional accounts only; never in a real deployment) |

## Deploy (Vercel + Supabase)

1. Create a Supabase project; set `DATABASE_URL` (pooler URL), `JWT_SECRET`, `CRON_SECRET`, signing keys and any AI keys in Vercel.
2. `DATABASE_URL=... npm run db:migrate && DATABASE_URL=... npm run db:seed`
3. Deploy. `vercel.json` schedules `/api/cron/jobs` (webhook retries, proof deadlines, drift checks); jobs also run after each write request.

## Architecture

```
Next.js (App Router) ── /api/[[...route]] ── Hono + zod-openapi
   │                                            │
   │   middleware: request id → JWT/API key → rate limit → plan usage
   │                                            │
   ├─ services: cases · consent · verify (Signed Truth) · rules (+twin) · eval · agent · rag · ivr · sync · insights · redteam
   ├─ domain (pure, tested): decision · rules · names · scam · documents
   ├─ ai: claude (structured outputs) · jev (decisions) · speech (whisper) · signals (Jev → heuristic fallback)
   └─ db: Drizzle ORM · Postgres/Supabase (PGlite locally) · SQL migrations in ./drizzle
```

## Known limits (said plainly)

- Synthetic evaluation shows *how* thresholds are chosen; it is not real-world accuracy.
- The rate limiter is in-memory per instance (swap for Redis in production).
- Vision tamper detection relies on the signed QR and visible-edit signs; it does not do pixel-level forensics.
- Jev's language coverage for Urdu is not documented; voice goes through Whisper first and the heuristic fallback is always available.
- SMS/WhatsApp/IVR telephony is simulated.
