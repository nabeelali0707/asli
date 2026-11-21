# Stated limits and a critique of our own trust picture

We would rather a judge read this here than discover it on stage.

## What the numbers do and do not mean

- **All evaluation data is synthetic** (frozen datasets D1–D6, `datasets/SPEC.md`). They show *how* thresholds are chosen and how calibration is measured. They are not real-world accuracy.
- **The calibrated scorer** (logistic regression + isotonic) was trained, calibrated and tested on a 300/100/100 split, separated by scenario pool. Isotonic calibration on 100 cases is coarse; we merge blocks smaller than 8 cases and smooth so the score never claims certainty. ECE improves from 0.146 to about 0.076 *on this benchmark only*.
- **Zero wrong auto-approvals on the test split proves little**: with 20 auto-approved test cases, the rule of three says the true rate could still be up to 15%. That is why auto-approval only *reserves* money and a human still releases it.
- **Cost figures are assumptions** (wrong approval Rs 50,000, review Rs 500, delay Rs 2,000, 25% of wrong provisional approvals missed during cooling-off). Change them in the rule set and the threshold moves.
- **The scam heuristic was tuned on the D3 development set.** We wrote a separate held-out set afterwards and report it separately (`POST /eval/benchmarks`). Real scam language changes weekly.

## Known technical limits

- **Image reuse (S8)**: a perceptual (difference) hash cannot tell two people's forms apart when they share a template — we measured two different people's mock CNICs at 1 bit apart out of 64. S8 therefore fires only for byte-identical images, or near-identical images carrying the *same* identity. Edited cards are caught by the signed-QR check (S7), not by S8. There is no pixel-level forensics.
- **Vision and speech are optional.** Without API keys, document text is not read (only quality + signed QR), and voice intake needs an on-device transcript. Every trace says which path ran.
- **Jev's Urdu coverage is undocumented.** Voice goes through Whisper first; the heuristic fallback is always available and recorded.
- **The rate limiter and circuit breaker are in-memory per instance.** Production needs a shared store (Redis).
- **Telephony is simulated.** SMS/WhatsApp/IVR deliveries are recorded, not sent.
- **The durable pipeline is in-database**, resumed by a job; it is not a distributed workflow engine.

## Critique of the trust picture (where Asli could still be fooled or misused)

1. **Signed Truth is only as strong as the signing key.** If the Ed25519 private key leaks, forged notices verify. In development the key sits in the database; production must use a KMS/HSM and key rotation (`kid` is already in every token).
2. **The 4-digit spoken code is an accessibility aid, not proof.** 10,000 values can be guessed or shoulder-surfed. The proof is the signature and the ledger check; we say so in the UI copy.
3. **Caller ID can be spoofed.** "Press 9" from the old number *freezes* a change — a spoofed call can only make things safer (freeze), never unfreeze or redirect money.
4. **Helpers are trusted intermediaries.** A dishonest helper who knows a family's PIN can still request an account change. Mitigations: officer approval by someone else, 48 h cooling-off, notice to the old number, exact-amount receipts, and per-helper anomaly rules. None of these stops collusion between a helper and an officer.
5. **Two-person approval does not stop two colluding officers.** The audit chain and anomaly rules make collusion visible afterwards; they do not prevent it.
6. **Consent withdrawal cannot erase what was already seen.** It stops future access and strips personal fields from auditor traces, but an officer who already read a record remembers it, and the append-only audit log keeps action metadata by design.
7. **A database superuser can disable the audit trigger.** The chain then *detects* edits and deletions (`audit_verify()`), but cannot prevent them. Anchoring the chain head externally (e.g. a daily published hash) would close this gap.
8. **"Prove, don't share" attestations reveal a yes/no.** Even a yes/no about eligibility is information about a person; attestations are audience-bound and expire, but they are still disclosures.
9. **Break-glass can be abused** by an officer with a plausible reason. It is time-boxed (15 min), reasoned, and visible to the citizen — a deterrent, not a lock.
10. **Synthetic users don't behave like real ones.** A widow on a shared phone may not understand a PIN, a cooling-off period or a verify link. Field testing with real users (not real data) is the next step.
