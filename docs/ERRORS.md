# Error codes

Every error is RFC 9457 `application/problem+json`: `{ type, title, status, detail, instance, code, requestId }` (plus a legacy `error` object). `type` links to the anchor below.

## account_exists

`ACCOUNT_EXISTS` — see `detail` for the human-readable reason. Search the code for `"ACCOUNT_EXISTS"` to find where it is raised.

## admin_only

`ADMIN_ONLY` — see `detail` for the human-readable reason. Search the code for `"ADMIN_ONLY"` to find where it is raised.

## ai_cannot_decide

`AI_CANNOT_DECIDE` — see `detail` for the human-readable reason. Search the code for `"AI_CANNOT_DECIDE"` to find where it is raised.

## ai_cannot_initiate_payment

`AI_CANNOT_INITIATE_PAYMENT` — see `detail` for the human-readable reason. Search the code for `"AI_CANNOT_INITIATE_PAYMENT"` to find where it is raised.

## already_paid

`ALREADY_PAID` — see `detail` for the human-readable reason. Search the code for `"ALREADY_PAID"` to find where it is raised.

## already_submitted

`ALREADY_SUBMITTED` — see `detail` for the human-readable reason. Search the code for `"ALREADY_SUBMITTED"` to find where it is raised.

## amount_required

`AMOUNT_REQUIRED` — see `detail` for the human-readable reason. Search the code for `"AMOUNT_REQUIRED"` to find where it is raised.

## appeal_needs_different_officer

`APPEAL_NEEDS_DIFFERENT_OFFICER` — see `detail` for the human-readable reason. Search the code for `"APPEAL_NEEDS_DIFFERENT_OFFICER"` to find where it is raised.

## auditor_view_staff_only

`AUDITOR_VIEW_STAFF_ONLY` — see `detail` for the human-readable reason. Search the code for `"AUDITOR_VIEW_STAFF_ONLY"` to find where it is raised.

## bad_pin

`BAD_PIN` — see `detail` for the human-readable reason. Search the code for `"BAD_PIN"` to find where it is raised.

## bad_url

`BAD_URL` — see `detail` for the human-readable reason. Search the code for `"BAD_URL"` to find where it is raised.

## cannot_attest

`CANNOT_ATTEST` — see `detail` for the human-readable reason. Search the code for `"CANNOT_ATTEST"` to find where it is raised.

## cannot_cancel

`CANNOT_CANCEL` — see `detail` for the human-readable reason. Search the code for `"CANNOT_CANCEL"` to find where it is raised.

## cannot_grant

`CANNOT_GRANT` — see `detail` for the human-readable reason. Search the code for `"CANNOT_GRANT"` to find where it is raised.

## cannot_withdraw

`CANNOT_WITHDRAW` — see `detail` for the human-readable reason. Search the code for `"CANNOT_WITHDRAW"` to find where it is raised.

## case_locked

`CASE_LOCKED` — see `detail` for the human-readable reason. Search the code for `"CASE_LOCKED"` to find where it is raised.

## change_already_pending

`CHANGE_ALREADY_PENDING` — see `detail` for the human-readable reason. Search the code for `"CHANGE_ALREADY_PENDING"` to find where it is raised.

## circuit_open

`CIRCUIT_OPEN` — see `detail` for the human-readable reason. Search the code for `"CIRCUIT_OPEN"` to find where it is raised.

## citizen_only

`CITIZEN_ONLY` — see `detail` for the human-readable reason. Search the code for `"CITIZEN_ONLY"` to find where it is raised.

## citizen_or_family_session

`CITIZEN_OR_FAMILY_SESSION` — see `detail` for the human-readable reason. Search the code for `"CITIZEN_OR_FAMILY_SESSION"` to find where it is raised.

## citizen_required

`CITIZEN_REQUIRED` — see `detail` for the human-readable reason. Search the code for `"CITIZEN_REQUIRED"` to find where it is raised.

## consent_required

`CONSENT_REQUIRED` — see `detail` for the human-readable reason. Search the code for `"CONSENT_REQUIRED"` to find where it is raised.

## consent_revoked

`CONSENT_REVOKED` — see `detail` for the human-readable reason. Search the code for `"CONSENT_REVOKED"` to find where it is raised.

## empty_file

`EMPTY_FILE` — see `detail` for the human-readable reason. Search the code for `"EMPTY_FILE"` to find where it is raised.

## family_session_required

`FAMILY_SESSION_REQUIRED` — see `detail` for the human-readable reason. Search the code for `"FAMILY_SESSION_REQUIRED"` to find where it is raised.

## field_not_correctable

`FIELD_NOT_CORRECTABLE` — see `detail` for the human-readable reason. Search the code for `"FIELD_NOT_CORRECTABLE"` to find where it is raised.

## file_too_large

`FILE_TOO_LARGE` — see `detail` for the human-readable reason. Search the code for `"FILE_TOO_LARGE"` to find where it is raised.

## forbidden_role

`FORBIDDEN_ROLE` — see `detail` for the human-readable reason. Search the code for `"FORBIDDEN_ROLE"` to find where it is raised.

## helper_only

`HELPER_ONLY` — see `detail` for the human-readable reason. Search the code for `"HELPER_ONLY"` to find where it is raised.

## idempotency_key_invalid

`IDEMPOTENCY_KEY_INVALID` — see `detail` for the human-readable reason. Search the code for `"IDEMPOTENCY_KEY_INVALID"` to find where it is raised.

## idempotency_key_required

`IDEMPOTENCY_KEY_REQUIRED` — see `detail` for the human-readable reason. Search the code for `"IDEMPOTENCY_KEY_REQUIRED"` to find where it is raised.

## idempotency_key_reused

`IDEMPOTENCY_KEY_REUSED` — see `detail` for the human-readable reason. Search the code for `"IDEMPOTENCY_KEY_REUSED"` to find where it is raised.

## invalid_amount

`INVALID_AMOUNT` — see `detail` for the human-readable reason. Search the code for `"INVALID_AMOUNT"` to find where it is raised.

## invalid_assignee

`INVALID_ASSIGNEE` — see `detail` for the human-readable reason. Search the code for `"INVALID_ASSIGNEE"` to find where it is raised.

## invalid_rules

`INVALID_RULES` — see `detail` for the human-readable reason. Search the code for `"INVALID_RULES"` to find where it is raised.

## invalid_scopes

`INVALID_SCOPES` — see `detail` for the human-readable reason. Search the code for `"INVALID_SCOPES"` to find where it is raised.

## invalid_thresholds

`INVALID_THRESHOLDS` — see `detail` for the human-readable reason. Search the code for `"INVALID_THRESHOLDS"` to find where it is raised.

## nothing_to_check

`NOTHING_TO_CHECK` — see `detail` for the human-readable reason. Search the code for `"NOTHING_TO_CHECK"` to find where it is raised.

## not_approved

`NOT_APPROVED` — see `detail` for the human-readable reason. Search the code for `"NOT_APPROVED"` to find where it is raised.

## not_a_draft

`NOT_A_DRAFT` — see `detail` for the human-readable reason. Search the code for `"NOT_A_DRAFT"` to find where it is raised.

## not_found

`NOT_FOUND` — see `detail` for the human-readable reason. Search the code for `"NOT_FOUND"` to find where it is raised.

## not_open

`NOT_OPEN` — see `detail` for the human-readable reason. Search the code for `"NOT_OPEN"` to find where it is raised.

## not_pending

`NOT_PENDING` — see `detail` for the human-readable reason. Search the code for `"NOT_PENDING"` to find where it is raised.

## not_released

`NOT_RELEASED` — see `detail` for the human-readable reason. Search the code for `"NOT_RELEASED"` to find where it is raised.

## not_replayable

`NOT_REPLAYABLE` — see `detail` for the human-readable reason. Search the code for `"NOT_REPLAYABLE"` to find where it is raised.

## not_resumable

`NOT_RESUMABLE` — see `detail` for the human-readable reason. Search the code for `"NOT_RESUMABLE"` to find where it is raised.

## not_reviewable

`NOT_REVIEWABLE` — see `detail` for the human-readable reason. Search the code for `"NOT_REVIEWABLE"` to find where it is raised.

## not_second_approver

`NOT_SECOND_APPROVER` — see `detail` for the human-readable reason. Search the code for `"NOT_SECOND_APPROVER"` to find where it is raised.

## not_your_case

`NOT_YOUR_CASE` — see `detail` for the human-readable reason. Search the code for `"NOT_YOUR_CASE"` to find where it is raised.

## no_citizen_profile

`NO_CITIZEN_PROFILE` — see `detail` for the human-readable reason. Search the code for `"NO_CITIZEN_PROFILE"` to find where it is raised.

## no_decision

`NO_DECISION` — see `detail` for the human-readable reason. Search the code for `"NO_DECISION"` to find where it is raised.

## no_scorer

`NO_SCORER` — see `detail` for the human-readable reason. Search the code for `"NO_SCORER"` to find where it is raised.

## no_speech

`NO_SPEECH` — see `detail` for the human-readable reason. Search the code for `"NO_SPEECH"` to find where it is raised.

## no_tenant

`NO_TENANT` — see `detail` for the human-readable reason. Search the code for `"NO_TENANT"` to find where it is raised.

## officer_only

`OFFICER_ONLY` — see `detail` for the human-readable reason. Search the code for `"OFFICER_ONLY"` to find where it is raised.

## payout_account_changed

`PAYOUT_ACCOUNT_CHANGED` — see `detail` for the human-readable reason. Search the code for `"PAYOUT_ACCOUNT_CHANGED"` to find where it is raised.

## payout_account_change_pending

`PAYOUT_ACCOUNT_CHANGE_PENDING` — see `detail` for the human-readable reason. Search the code for `"PAYOUT_ACCOUNT_CHANGE_PENDING"` to find where it is raised.

## payout_alias_missing

`PAYOUT_ALIAS_MISSING` — see `detail` for the human-readable reason. Search the code for `"PAYOUT_ALIAS_MISSING"` to find where it is raised.

## payout_in_cooling_off

`PAYOUT_IN_COOLING_OFF` — see `detail` for the human-readable reason. Search the code for `"PAYOUT_IN_COOLING_OFF"` to find where it is raised.

## pin_locked

`PIN_LOCKED` — see `detail` for the human-readable reason. Search the code for `"PIN_LOCKED"` to find where it is raised.

## plan_limit_reached

`PLAN_LIMIT_REACHED` — see `detail` for the human-readable reason. Search the code for `"PLAN_LIMIT_REACHED"` to find where it is raised.

## raast_alias_invalid

`RAAST_ALIAS_INVALID` — see `detail` for the human-readable reason. Search the code for `"RAAST_ALIAS_INVALID"` to find where it is raised.

## rate_limited

`RATE_LIMITED` — see `detail` for the human-readable reason. Search the code for `"RATE_LIMITED"` to find where it is raised.

## reason_required

`REASON_REQUIRED` — see `detail` for the human-readable reason. Search the code for `"REASON_REQUIRED"` to find where it is raised.

## same_account

`SAME_ACCOUNT` — see `detail` for the human-readable reason. Search the code for `"SAME_ACCOUNT"` to find where it is raised.

## same_approver

`SAME_APPROVER` — see `detail` for the human-readable reason. Search the code for `"SAME_APPROVER"` to find where it is raised.

## segregation_of_duties

`SEGREGATION_OF_DUTIES` — see `detail` for the human-readable reason. Search the code for `"SEGREGATION_OF_DUTIES"` to find where it is raised.

## self_grant

`SELF_GRANT` — see `detail` for the human-readable reason. Search the code for `"SELF_GRANT"` to find where it is raised.

## service_down

`SERVICE_DOWN` — see `detail` for the human-readable reason. Search the code for `"SERVICE_DOWN"` to find where it is raised.

## service_error

`SERVICE_ERROR` — see `detail` for the human-readable reason. Search the code for `"SERVICE_ERROR"` to find where it is raised.

## service_timeout

`SERVICE_TIMEOUT` — see `detail` for the human-readable reason. Search the code for `"SERVICE_TIMEOUT"` to find where it is raised.

## speech_unavailable

`SPEECH_UNAVAILABLE` — see `detail` for the human-readable reason. Search the code for `"SPEECH_UNAVAILABLE"` to find where it is raised.

## staff_only

`STAFF_ONLY` — see `detail` for the human-readable reason. Search the code for `"STAFF_ONLY"` to find where it is raised.

## step_failed

`STEP_FAILED` — see `detail` for the human-readable reason. Search the code for `"STEP_FAILED"` to find where it is raised.

## step_timeout

`STEP_TIMEOUT` — see `detail` for the human-readable reason. Search the code for `"STEP_TIMEOUT"` to find where it is raised.

## too_many_attempts

`TOO_MANY_ATTEMPTS` — see `detail` for the human-readable reason. Search the code for `"TOO_MANY_ATTEMPTS"` to find where it is raised.

## unauthenticated

`UNAUTHENTICATED` — see `detail` for the human-readable reason. Search the code for `"UNAUTHENTICATED"` to find where it is raised.

## unknown_case_ref

`UNKNOWN_CASE_REF` — see `detail` for the human-readable reason. Search the code for `"UNKNOWN_CASE_REF"` to find where it is raised.

## unknown_claim

`UNKNOWN_CLAIM` — see `detail` for the human-readable reason. Search the code for `"UNKNOWN_CLAIM"` to find where it is raised.

## unknown_events

`UNKNOWN_EVENTS` — see `detail` for the human-readable reason. Search the code for `"UNKNOWN_EVENTS"` to find where it is raised.

## users_only

`USERS_ONLY` — see `detail` for the human-readable reason. Search the code for `"USERS_ONLY"` to find where it is raised.

## use_signup

`USE_SIGNUP` — see `detail` for the human-readable reason. Search the code for `"USE_SIGNUP"` to find where it is raised.

## wrong_family

`WRONG_FAMILY` — see `detail` for the human-readable reason. Search the code for `"WRONG_FAMILY"` to find where it is raised.

## wrong_pin

`WRONG_PIN` — see `detail` for the human-readable reason. Search the code for `"WRONG_PIN"` to find where it is raised.

## validation_error

`VALIDATION_ERROR` — see `detail` for the human-readable reason. Search the code for `"VALIDATION_ERROR"` to find where it is raised.

## internal

`INTERNAL` — see `detail` for the human-readable reason. Search the code for `"INTERNAL"` to find where it is raised.

