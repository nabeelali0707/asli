# Brief-compliance matrix

Every requirement in the Coder's Cup 2026 brief, where it lives, and the evidence a judge can check. "Test" names refer to files in `tests/`; "Break It" ids refer to `POST /api/v1/redteam/run-all` (`src/server/services/breakit.ts`).

## Constraints (section 03)

| Brief constraint | How Asli meets it | Evidence |
| --- | --- | --- |
| Wrong approvals cost more than slow approvals | Money is never moved by AI. Lane `auto` only **reserves** money (24 h cooling-off, cancellable, human release). Threshold derived from costs: `max(0.90, (W·m − R)/(W·m + D))`. Two officers above Rs 10,000. | `GET /eval/auto-threshold` (formula vs empirical minimum, rule-of-three bound); `hardstops.test.ts`; Break It A13 |
| Weak internet | Idempotency keys (required on money endpoints), offline outbox sync, small JSON, pre-recorded audio keys, chaos panel latency, circuit breaker, durable resumable pipeline | `api.test.ts` "offline sync & idempotency"; `round3.test.ts` chaos; Break It A16 |
| Low literacy | Every message bilingual (Urdu/English) with an audio key; voice intake; IVR feature-phone line (status, check code, talk to a person, confirm amount, press 9) | `/voice/intake`, `/ivr/*`, `/voice/clips` |
| Rules change without notice | Versioned JSON rules, validated, published without redeploy; every decision stores its rule version; Digital Twin preview; kill switch | `api.test.ts` "rules change without code"; `/rules/*` |
| Bad data | Name normaliser, Fellegi–Sunter search with review zone + ambiguity stop (S3), CNIC-typo never verifies, never auto-merge, three-valued rules | `domain.test.ts`, `hardstops.test.ts`; D2 benchmark: 0/100 different people verified |
| Explainable decisions | Citizen view (plain Urdu/English + counterfactuals) and auditor view (input, versions, confidence, trace) for **every** AI judgement, with replay | `/ai-decisions/*`; `round3.test.ts` "two views + replay" |
| User control of data | See / share / withdraw / correct; withdrawal checked live on every access **and** before every pipeline step | Break It A11, A12; `round3.test.ts` |
| "I am not sure" | 12 named hard stops; uncertainty band on advisory models (escalate-only); handoff note with every failed check; deadline escalates, never auto-rejects | `hardstops.test.ts` (S1–S12 golden) |

## Roles, platform, AI (sections 03–04)

| Requirement | Implementation |
| --- | --- |
| ≥ 3 roles | citizen, community helper, department officer, admin, auditor — enforced server-side (`docs/permission-matrix.md`) |
| JWT/OAuth + RBAC | JWT (HS256) with token-version revocation; role + tenant + consent checks in services |
| Dashboard data | `/analytics`, `/officer/queue`, `/cases/mine`, `/transparency` |
| Case management | create, assign, escalate, close, notes, appeal, complaints queue |
| Public REST API + keys + OpenAPI | `/api/docs`, `/api/openapi.json`, scoped `X-API-Key`, plans with monthly limits |
| Audit log of every user/AI/agent action | Postgres trigger hash chain; updates/deletes blocked; `audit_verify()` names first broken row and detects deleted/truncated rows |
| Consent management | `/consent*` |
| Mock identity / payment / data services | mock NADRA, income registry, Raast — consent-gated, chaos-injectable |
| Platform extras (≥ 3) | multi-tenant departments (404 across tenants) · rule editor · notifications (in-app, mock SMS/IVR) · webhooks (HMAC) · analytics per tenant · officer queue by priority & confidence · subscription plans & usage limits · background jobs & durable pipeline · rate limiting (IETF RateLimit headers) & RFC 9457 errors · offline sync |
| AI features (≥ 3) | Jev classification & routing · structured outputs (Claude) · computer vision (blur, signed QR, vision read, dHash reuse) · Urdu voice (Whisper) · policy RAG with sources · agent + tool calls with guardrails · explainability + counterfactuals · anomaly detection · evaluation dashboard (calibrated scorer, benchmarks) · memory (case history) |
| Postgres + migrations, deployed link, monitoring/tests | Drizzle migrations (incl. trigger SQL), `/api/health`, 73 tests, Vercel config |

## Technical challenges (section 04)

| Challenge | Answer |
| --- | --- |
| 01 Cost of being wrong | Provisional auto-approve lane with cost-derived threshold, cap, cooling-off; empirical cost curve published beside the formula |
| 02 Saying "I am not sure" | Hard stops + "not sure" band + handoff notes with evidence; S12 when a registry is down |
| 03 Bad data | FS matching + ambiguity stop; never auto-merge; frozen D2 benchmark with denominators |
| 04 Rules that change | Versioned rules; old decisions keep their version; replay under original vs current version |
| 05 Explain and audit | Two views for every AI decision; DB-enforced audit chain |
| 06 Consent and take-back | Live checks; pipeline halts mid-run; auditor traces stripped of PII after withdrawal |
| 07 Works for everyone | Voice, IVR, audio keys, small pages, offline sync, PIN lock for shared phones |
| 08 Scams and fake documents | Signed Truth (ledger first); forged-QR detection; image reuse; false alarms counted publicly and on a held-out set |

## Bonus features (section 05)

| Bonus | Status |
| --- | --- |
| Digital Twin | `POST /rules/{id}/simulate` |
| Helper Mode | PIN switch, 20-min family token, per-family consent, lockout |
| Offline-First Sync | `POST /sync` (ordered outbox, opId idempotency) |
| Scam Map | `/scam-map`, `/scam-map/public` with spike alerts |

## Rules (section 06)

| Rule | How |
| --- | --- |
| Mock everything, no real data | All registries and people are fictional; generated mock CNICs say "NOT A REAL DOCUMENT" |
| Label as prototype | `/api/health`, OpenAPI title, every page and README |
| Tell judges what is real vs simulated | README table + `docs/LIMITS.md` |
