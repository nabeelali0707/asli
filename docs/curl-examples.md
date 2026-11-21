# curl examples (generated)

Set `BASE=http://localhost:3000/api/v1` (or your deployed URL). Get tokens with the login call, or from `GET /api/v1/demo/tokens` when `ASLI_DEMO_MODE=true` (fictional demo accounts only). Demo password and PIN: see `src/server/demo/seed.ts`.

```bash
BASE=http://localhost:3000/api/v1
TOKEN=$(curl -s $BASE/auth/login -H 'content-type: application/json' -d '{"email":"officer@asli.demo","password":"'"$DEMO_PASSWORD"'"}' | jq -r .token)
```

### Current user, role and (for helpers) the active family session

```bash
curl -s -X GET "$BASE/auth/me" -H "authorization: Bearer $TOKEN"
```

### Families this helper may assist (masked until PIN switch)

```bash
curl -s -X GET "$BASE/helper/families" -H "authorization: Bearer $TOKEN"
```

### My cases (citizen) or the active family's cases (helper), with spoken reasons

```bash
curl -s -X GET "$BASE/cases/mine" -H "authorization: Bearer $TOKEN"
```

### Case detail: decisions (user reason + full trace for staff), documents, notes, payout, notices

```bash
curl -s -X GET "$BASE/cases/<ID>" -H "authorization: Bearer $TOKEN"
```

### Review queue sorted by priority, then lowest confidence, then oldest

```bash
curl -s -X GET "$BASE/officer/queue" -H "authorization: Bearer $TOKEN"
```

### Verify a token from a verify link (/v/{token})

```bash
curl -s -X GET "$BASE/verify/<ID>" -H "authorization: Bearer $TOKEN"
```

### Public key used to sign notices and attestations (verify offline)

```bash
curl -s -X GET "$BASE/signing-key" -H "authorization: Bearer $TOKEN"
```

### Who has my data, what they can see, and who actually used it

```bash
curl -s -X GET "$BASE/consent" -H "authorization: Bearer $TOKEN"
```

### Open correction requests (officer)

```bash
curl -s -X GET "$BASE/consent/corrections/open" -H "authorization: Bearer $TOKEN"
```

### Citizen profile (masked for staff; full for the person and consented helpers)

```bash
curl -s -X GET "$BASE/citizens/<ID>" -H "authorization: Bearer $TOKEN"
```

### Mock NADRA + income registry lookup (consent-gated; 403 when withdrawn)

```bash
curl -s -X GET "$BASE/citizens/<ID>/registry" -H "authorization: Bearer $TOKEN"
```

### Fixed spoken prompts (en/ur) by audio key — pre-record or cache these for 2G

```bash
curl -s -X GET "$BASE/voice/clips" -H "authorization: Bearer $TOKEN"
```

### The rule version that applies to the next decision

```bash
curl -s -X GET "$BASE/rules/active" -H "authorization: Bearer $TOKEN"
```

### All rule versions (drafts, published, archived)

```bash
curl -s -X GET "$BASE/rules" -H "authorization: Bearer $TOKEN"
```

### Staff users in this department

```bash
curl -s -X GET "$BASE/admin/users" -H "authorization: Bearer $TOKEN"
```

### API keys (secrets never shown again)

```bash
curl -s -X GET "$BASE/admin/api-keys" -H "authorization: Bearer $TOKEN"
```

### Webhooks and recent deliveries

```bash
curl -s -X GET "$BASE/admin/webhooks" -H "authorization: Bearer $TOKEN"
```

### Department workspace, plan and monthly usage

```bash
curl -s -X GET "$BASE/admin/tenant" -H "authorization: Bearer $TOKEN"
```

### Break It: 18 attacks + 8 legitimate controls

```bash
curl -s -X GET "$BASE/redteam/attacks" -H "authorization: Bearer $TOKEN"
```

### Department dashboard: cases, lanes, channels, payouts, officer overrides, false alarms

```bash
curl -s -X GET "$BASE/analytics" -H "authorization: Bearer $TOKEN"
```

### Public numbers, including false alarms and share sent to humans

```bash
curl -s -X GET "$BASE/transparency" -H "authorization: Bearer $TOKEN"
```

### Scam reports by district, category and day, with spike alerts

```bash
curl -s -X GET "$BASE/scam-map" -H "authorization: Bearer $TOKEN"
```

### Public, anonymous scam map (all departments)

```bash
curl -s -X GET "$BASE/scam-map/public" -H "authorization: Bearer $TOKEN"
```

### Scam reports for review

```bash
curl -s -X GET "$BASE/scam-reports" -H "authorization: Bearer $TOKEN"
```

### Anomaly detection: shared payout accounts, repeated claims, reused documents, helper spikes, scam spikes

```bash
curl -s -X GET "$BASE/anomalies" -H "authorization: Bearer $TOKEN"
```

### Past evaluation runs

```bash
curl -s -X GET "$BASE/eval/runs" -H "authorization: Bearer $TOKEN"
```

### Audit log (every user, AI, agent and API action, including denials)

```bash
curl -s -X GET "$BASE/audit" -H "authorization: Bearer $TOKEN"
```

### Recompute the hash chain — proves no row was edited or deleted

```bash
curl -s -X GET "$BASE/audit/verify" -H "authorization: Bearer $TOKEN"
```

### My in-app notifications (with audio keys for voice playback)

```bash
curl -s -X GET "$BASE/notifications" -H "authorization: Bearer $TOKEN"
```

### The 12 named hard stops (S1–S12). Any one sends a case to a human, whatever the score.

```bash
curl -s -X GET "$BASE/hard-stops" -H "authorization: Bearer $TOKEN"
```

### Every AI judgement (case decisions, scam verdicts, routing, signals, policy answers, extractions)

```bash
curl -s -X GET "$BASE/ai-decisions" -H "authorization: Bearer $TOKEN"
```

### One AI decision — citizen view (plain words) or auditor view (input, versions, confidence, trace; personal fields removed after consent withdrawal)

```bash
curl -s -X GET "$BASE/ai-decisions/<ID>" -H "authorization: Bearer $TOKEN"
```

### Decision pipeline runs (steps, attempts, timings, halts on consent withdrawal)

```bash
curl -s -X GET "$BASE/pipelines" -H "authorization: Bearer $TOKEN"
```

### Fault injection settings + circuit breaker state for the mock services

```bash
curl -s -X GET "$BASE/chaos" -H "authorization: Bearer $TOKEN"
```

### Scoring model versions, calibration metrics (Brier, ECE, reliability bins)

```bash
curl -s -X GET "$BASE/eval/scorer" -H "authorization: Bearer $TOKEN"
```

### Cost curve over the auto-approve threshold: empirical minimum beside the formula threshold, rule-of-three bound

```bash
curl -s -X GET "$BASE/eval/auto-threshold" -H "authorization: Bearer $TOKEN"
```

### Frozen dataset manifest: sizes, label counts, sha256

```bash
curl -s -X GET "$BASE/eval/datasets" -H "authorization: Bearer $TOKEN"
```

### The spoken question: 'Did you receive exactly Rs X?'

```bash
curl -s -X GET "$BASE/payouts/<ID>/receipt-prompt" -H "authorization: Bearer $TOKEN"
```

### Account change requests (citizen: own; staff: department)

```bash
curl -s -X GET "$BASE/payout-account/changes" -H "authorization: Bearer $TOKEN"
```

### Complaints, appeals, data corrections, frozen account changes and scam reports awaiting review

```bash
curl -s -X GET "$BASE/officer/complaints" -H "authorization: Bearer $TOKEN"
```

### Ready-made tokens for every demo role (ONLY when ASLI_DEMO_MODE=true; all data is fictional)

```bash
curl -s -X GET "$BASE/demo/tokens" -H "authorization: Bearer $TOKEN"
```

### Sign in (returns a JWT)

```bash
curl -s -X POST "$BASE/auth/login" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"email":"nobody@asli.demo","password":"wrong-password"}'
```

### Citizen self sign-up

```bash
curl -s -X POST "$BASE/auth/register" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"fullName":"Matrix Person","phone":"03008970961","password":"matrix-pass-1"}'
```

### Enrol a family on the shared phone (family sets PIN, consents aloud)

```bash
curl -s -X POST "$BASE/helper/families" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"fullName":"Matrix Family","pin":"1234","spokenConsent":"haan"}'
```

### Switch to a family with their PIN → 20-minute family token

```bash
curl -s -X POST "$BASE/helper/switch" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"citizenId":"ctz_zainab","pin":"4321"}'
```

### Create a case (idempotent via clientRef or Idempotency-Key)

```bash
curl -s -X POST "$BASE/cases" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"claim":{"householdSize":3}}'
```

### Update claim fields (draft / needs_proof only)

```bash
curl -s -X PATCH "$BASE/cases/<ID>/claim" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"householdSize":3}'
```

### Upload a document → blur check, signed-QR check, vision read, tamper score

```bash
curl -s -X POST "$BASE/cases/<ID>/documents" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"kind":"other","mime":"image/png","contentBase64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}'
```

### Submit → department consent receipt + signed 'received' notice + AI decision (fast / ask_proof / human)

```bash
curl -s -X POST "$BASE/cases/<ID>/submit" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Appeal a decision (opens a linked case for a DIFFERENT officer)

```bash
curl -s -X POST "$BASE/cases/<ID>/appeal" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"statement":"I disagree","via":"voice"}'
```

### Escalate to a human (citizen 'talk to a person', or officer)

```bash
curl -s -X POST "$BASE/cases/<ID>/escalate" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"reason":"talk to a person"}'
```

### Replay an offline outbox in order (each opId applied at most once)

```bash
curl -s -X POST "$BASE/sync" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"ops":[{"opId":"matrix-1795234375126","type":"update_claim","caseRef":"case_qbbag043tez2avr8","payload":{"householdSize":3}}]}'
```

### Assign / unassign an officer

```bash
curl -s -X POST "$BASE/cases/<ID>/assign" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"officerId":null}'
```

### Add a case note

```bash
curl -s -X POST "$BASE/cases/<ID>/notes" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"body":"matrix note"}'
```

### Ask the citizen for specific proof (signed notice + deadline)

```bash
curl -s -X POST "$BASE/cases/<ID>/request-proof" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"items":["cnic"]}'
```

### Approve the claim → payout (second approver needed above the limit). Requires Idempotency-Key.

```bash
curl -s -X POST "$BASE/cases/<ID>/approve" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Re-run the decision under the CURRENT rule version (old decisions keep theirs)

```bash
curl -s -X POST "$BASE/cases/<ID>/redecide" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Second approval for a large payout (different officer with second-approver right)

```bash
curl -s -X POST "$BASE/payouts/<ID>/approve" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Release an approved payout via mock Raast (humans only; AI gets 403)

```bash
curl -s -X POST "$BASE/payouts/<ID>/release" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Is this message real? Signature + case ledger + mock Raast first, classifier second

```bash
curl -s -X POST "$BASE/verify" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"text":"BISP: Rs 25,000 approved. Send Rs 500 fee."}'
```

### Give permission (returns a receipt to read aloud)

```bash
curl -s -X POST "$BASE/consent" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"granteeType":"department","granteeId":"tnt_rahat_punjab","scopes":["case.read"]}'
```

### Ask to correct my data

```bash
curl -s -X POST "$BASE/consent/corrections" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"field":"district","requestedValue":"Lahore"}'
```

### Apply or reject a correction (officer)

```bash
curl -s -X POST "$BASE/consent/corrections/<ID>/review" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"approve":false}'
```

### Officer full-detail view with a reason — logged and shown to the citizen

```bash
curl -s -X POST "$BASE/citizens/<ID>/break-glass" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"reason":"matrix permission check only"}'
```

### Issue a signed yes/no attestation instead of sharing data

```bash
curl -s -X POST "$BASE/citizens/<ID>/attestations" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"claim":"identity_verified","audience":"matrix"}'
```

### Verify an attestation token

```bash
curl -s -X POST "$BASE/attestations/verify" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"token":"ASLI1.x.y"}'
```

### Speak instead of filling a form: speech → text (Whisper) → validated claim fields (Claude) → confirmation prompt

```bash
curl -s -X POST "$BASE/voice/intake" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"transcript":"Mera naam Matrix hai"}'
```

### Ask about the rules — answered only from official (mock) policy, with sources; says 'not sure' otherwise

```bash
curl -s -X POST "$BASE/policy/ask" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"question":"Do I have to pay a fee?"}'
```

### Missed call → callback starts; returns the first spoken menu

```bash
curl -s -X POST "$BASE/ivr/calls" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"phone":"03001112233"}'
```

### Keypad input (1 status, 2 check a message code, 3 talk to a person)

```bash
curl -s -X POST "$BASE/ivr/calls/<ID>/input" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"digits":"1"}'
```

### Create a draft rule version (validated; no code change, no redeploy)

```bash
curl -s -X POST "$BASE/rules/drafts" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"definition":{"invalid":true}}'
```

### Digital Twin: replay a draft on every past case before it goes live

```bash
curl -s -X POST "$BASE/rules/<ID>/simulate" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Digital Twin for an unsaved definition

```bash
curl -s -X POST "$BASE/rules/simulate" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"definition":{"invalid":true}}'
```

### Publish a draft → applies to the next decision at once

```bash
curl -s -X POST "$BASE/rules/<ID>/publish" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Kill switch: turn the AI fast lane off/on (publishes a new rule version)

```bash
curl -s -X POST "$BASE/rules/fast-lane" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"enabled":true,"reason":"matrix"}'
```

### Create a helper, officer, admin or auditor

```bash
curl -s -X POST "$BASE/admin/users" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"email":"m1795234375127@asli.demo","password":"matrix-pass-1","role":"auditor","displayName":"Matrix"}'
```

### Activate / deactivate a user (revokes their sessions)

```bash
curl -s -X POST "$BASE/admin/users/<ID>/active" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"active":true}'
```

### Create an API key for the public REST API (shown once)

```bash
curl -s -X POST "$BASE/admin/api-keys" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"name":"matrix","scopes":["verify"]}'
```

### Revoke an API key

```bash
curl -s -X DELETE "$BASE/admin/api-keys/<ID>" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Subscribe an outside system to events (HMAC-signed, retried)

```bash
curl -s -X POST "$BASE/admin/webhooks" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"url":"https://example.com/hook","events":["case.decided"]}'
```

### Disable a webhook

```bash
curl -s -X DELETE "$BASE/admin/webhooks/<ID>" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Send a test delivery

```bash
curl -s -X POST "$BASE/admin/webhooks/<ID>/test" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Change subscription plan (rate + monthly API limits)

```bash
curl -s -X POST "$BASE/admin/tenant/plan" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"plan":"standard"}'
```

### Demo: make the mock government services slow (weak-network demo)

```bash
curl -s -X POST "$BASE/admin/mock-latency" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"ms":0}'
```

### Run one attack or control (A01–A18, C01–C08)

```bash
curl -s -X POST "$BASE/redteam/attacks/<ID>" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Confirm a scam or record a FALSE ALARM (counted publicly; reporter told)

```bash
curl -s -X POST "$BASE/scam-reports/<ID>/review" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"status":"confirmed_scam"}'
```

### Drift guard: if officers overturn too many fast-lane cases, switch the fast lane off

```bash
curl -s -X POST "$BASE/drift/check" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Fit lane cutoffs on ~200 labelled synthetic cases by minimising expected cost; report on a held-out split

```bash
curl -s -X POST "$BASE/eval/runs" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Turn an evaluation's recommended cutoffs into a rule DRAFT (admin publishes)

```bash
curl -s -X POST "$BASE/eval/runs/<ID>/draft-rules" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Replay: same stored input, same rule version (must reproduce) and current version (shows drift)

```bash
curl -s -X POST "$BASE/ai-decisions/<ID>/replay" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Resume a run that stopped mid-way (continues from the first unfinished step)

```bash
curl -s -X POST "$BASE/pipelines/<ID>/resume" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Set latency / failure rate / timeouts / outage for nadra | income | raast

```bash
curl -s -X POST "$BASE/chaos/<ID>" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"latencyMs":0}'
```

### Confirm the exact amount that arrived; 'less' or 'nothing' opens a complaint linked to the helper

```bash
curl -s -X POST "$BASE/payouts/<ID>/receipt" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"status":"received_full","via":"app"}'
```

### Ask to change where money is sent: family PIN → officer → 48 h cooling-off; old number told to press 9

```bash
curl -s -X POST "$BASE/payout-account/change" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"newAlias":"03119990000","pin":"0000"}'
```

### Officer approval (not the requester) → 48 h cooling-off

```bash
curl -s -X POST "$BASE/payout-account/changes/<ID>/approve" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Citizen app lock screen: family PIN → 10-minute session (the app auto-locks after inactivity)

```bash
curl -s -X POST "$BASE/auth/pin-unlock" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"pin":"0000"}'
```

### Reject (human only; citizen can appeal)

```bash
curl -s -X POST "$BASE/cases/<ID>/reject" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"reason":"matrix"}'
```

### Close a case

```bash
curl -s -X POST "$BASE/cases/<ID>/close" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

### Take permission back — access stops on the very next request

```bash
curl -s -X POST "$BASE/consent/<ID>/withdraw" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"reason":"matrix"}'
```

### Cancel a reserved / pending payout before money moves (citizen or officer). Requires Idempotency-Key.

```bash
curl -s -X POST "$BASE/payouts/<ID>/cancel" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"reason":"matrix"}'
```

### Officer rejects an account change

```bash
curl -s -X POST "$BASE/payout-account/changes/<ID>/reject" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"reason":"matrix"}'
```

### Freeze a pending change (citizen in the app, or officer). By phone: IVR option 9.

```bash
curl -s -X POST "$BASE/payout-account/changes/<ID>/freeze" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{}'
```

