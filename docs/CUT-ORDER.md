# Cut order, gates and feature freeze

If time runs out, we cut from the **bottom** of this list, never the top. Each gate must pass on the **deployed** URL before work starts on the next tier.

## Gates

| Gate | Must be true | How we check |
| --- | --- | --- |
| G0 Skeleton | Live URL, health green, every role can sign in | `GET /api/health`; login as each demo account |
| G1 Core loop | Widow's case: voice → documents → decision → officer → payout → signed notice | `npm test` (api.test.ts) on the deployed DB seed |
| G2 Safety | All hard-stop golden tests pass; Break It shows 18/18 attacks caught and 8/8 controls passing | `npm test`; `POST /redteam/run-all` |
| G3 Honesty | Benchmarks run with denominators; datasets match manifest; audit chain verifies | `POST /eval/benchmarks`; `GET /eval/datasets`; `GET /audit/verify` |
| Freeze | No new features; only fixes, copy and demo rehearsal | 6 hours before the deadline |

## Fixed cut order (top = never cut)

1. Decision engine: hard stops S1–S12, escalate-only, three human-safe lanes
2. AI never moves money: reservations, two-person release, guardrail 403
3. Consent: live checks, mid-pipeline halt, withdraw/see/correct
4. Signed Truth: signing, spoken code, ledger-first verification
5. Audit chain in the database + verify
6. Helper mode (PIN switch, per-family consent)
7. Voice intake + IVR (status, check code, talk to a person)
8. Rules versioning + Digital Twin
9. Payout-account change protection (PIN, officer, cooling-off, press 9)
10. Calibrated scorer + provisional auto-approve lane *(cut → system still works with fast/ask/human only)*
11. Break It panel + permission matrix
12. Exact-amount receipts + complaint queue
13. Frozen benchmarks D2–D5
14. Chaos panel + circuit breaker *(cut → S12 still fires on real errors)*
15. Anomaly rules (night edits, after-payment change, shortfalls)
16. Scam Map + transparency page
17. Webhooks, plans, API-key scopes
18. Prove-don't-share attestations, break-glass window
19. Policy RAG answers *(cut → static FAQ)*
20. Case agent with Claude tool runner *(cut → deterministic agent remains)*
