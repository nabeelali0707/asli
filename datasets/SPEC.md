# Frozen synthetic datasets — generator spec

All data is **fictional**. Generators live in `src/server/eval/datasets.ts`, use fixed seeds (mulberry32), and are written here by `npm run datasets:freeze`. `manifest.json` stores each file's sha256; `GET /api/v1/eval/datasets` re-generates and reports whether the committed files still match.

| Dataset | Rows | What it is | Labels | Used for |
| --- | --- | --- | --- | --- |
| D1 decision-cases | 500 | Complete decision inputs (identity evidence, documents, facts, advisory signals) | should_pay 210 · should_not_pay 230 · needs_info 60 | Train (300, pool A, seed 101) / calibrate (100, pool B, seed 202) / test (100, pool C, seed 303) the scorer; lane confusion; cost curve |
| D2 identity-pairs | 300 | Claim vs registry record | same person 200 · different 100 | Name variants, missing father, same name different person, CNIC reused by another, one-digit CNIC typo |
| D3 scam-messages | 30 | English, Urdu, Roman Urdu messages | scam 15 · genuine-like 6 · benign 9 | Detection rate and false alarms on legitimate controls; 10 rows are a held-out set written after tuning |
| D4 document-specs | 20 | Rendered live and checked | clean 6 · blurry 4 · edited QR 4 · third-party QR 3 · injection QR 3 | Blur detection, signed-QR verification, prompt-injection scan |
| D5 policy-questions | 20 | Citizen questions | answerable 16 (gold passage) · unanswerable 4 | Retrieval hit rate and abstention |
| D6 attacks | 26 | Break It list | attack 18 · control 8 | Red-team panel |

## Realism knobs in D1

- **Split by scenario pool**: pools A, B and C use different name lists, father names and districts, so no template is shared between train, calibration and test.
- **Hidden fraud** (6 per 100): looks clean to every feature but is labelled should_not_pay — so calibration cannot be perfect.
- **Messy but real** (10 per 100): legitimate claimants with missing father/DOB, moderate tamper noise and an unreadable income proof.

## Denominators

Every reported metric carries its denominator (`{ count, of }`). Misses are listed by id.
