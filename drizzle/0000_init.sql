CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "attestations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"citizen_id" text NOT NULL,
	"case_id" text,
	"claim" text NOT NULL,
	"value" boolean NOT NULL,
	"audience" text NOT NULL,
	"token" text NOT NULL,
	"issued_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_role" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"outcome" text DEFAULT 'ok' NOT NULL,
	"detail" jsonb,
	"request_id" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"author_type" text NOT NULL,
	"author_id" text,
	"kind" text DEFAULT 'note' NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"citizen_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"lane" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"confidence" real,
	"amount_requested" integer,
	"claim" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_via" text DEFAULT 'web' NOT NULL,
	"assigned_to" text,
	"parent_case_id" text,
	"proof_requested" jsonb,
	"proof_deadline" timestamp with time zone,
	"client_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "citizens" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text,
	"full_name" text NOT NULL,
	"name_key" text NOT NULL,
	"father_name" text,
	"cnic" text,
	"dob" text,
	"gender" text,
	"district" text,
	"phone" text,
	"language" text DEFAULT 'ur' NOT NULL,
	"payout_alias" text,
	"pin_hash" text,
	"merged_into" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"citizen_id" text NOT NULL,
	"grantee_type" text NOT NULL,
	"grantee_id" text NOT NULL,
	"purpose" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"granted_via" text DEFAULT 'web' NOT NULL,
	"receipt_hash" text NOT NULL,
	"receipt_text" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correction_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"citizen_id" text NOT NULL,
	"field" text NOT NULL,
	"current_value" text,
	"requested_value" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"rule_set_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"lane" text NOT NULL,
	"eligible" boolean,
	"score" real NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"hard_stops" jsonb NOT NULL,
	"user_reason" jsonb NOT NULL,
	"counterfactuals" jsonb NOT NULL,
	"trace" jsonb NOT NULL,
	"model_info" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"actor_type" text DEFAULT 'ai' NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"case_id" text,
	"citizen_id" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content_base64" text NOT NULL,
	"extracted" jsonb,
	"checks" jsonb,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"case_count" integer NOT NULL,
	"costs" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"curve" jsonb NOT NULL,
	"confusion" jsonb NOT NULL,
	"thresholds" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"label" text NOT NULL,
	"district" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "ivr_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"citizen_id" text,
	"state" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_income" (
	"cnic" text PRIMARY KEY NOT NULL,
	"monthly_income" integer NOT NULL,
	"household_size" integer NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_nadra" (
	"cnic" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"father_name" text NOT NULL,
	"dob" text NOT NULL,
	"gender" text NOT NULL,
	"district" text NOT NULL,
	"marital_status" text NOT NULL,
	"alive" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_raast_ledger" (
	"ref" text PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"amount" integer NOT NULL,
	"case_id" text,
	"payout_id" text NOT NULL,
	"status" text DEFAULT 'settled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"case_id" text NOT NULL,
	"citizen_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" integer,
	"payload" jsonb NOT NULL,
	"token" text NOT NULL,
	"code" text NOT NULL,
	"nonce" text NOT NULL,
	"key_id" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"verify_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notices_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"citizen_id" text,
	"channel" text NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"audio_key" text,
	"notice_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"case_id" text NOT NULL,
	"citizen_id" text NOT NULL,
	"amount" integer NOT NULL,
	"alias" text NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"required_approvals" integer NOT NULL,
	"approvals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raast_ref" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"definition" jsonb NOT NULL,
	"note" text,
	"created_by" text,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scam_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"reporter_id" text,
	"citizen_id" text,
	"text" text NOT NULL,
	"sender" text,
	"district" text,
	"verdict" text NOT NULL,
	"category" text,
	"classification" jsonb,
	"ledger_check" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" text,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'standard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"tenant_id" text NOT NULL,
	"period" text NOT NULL,
	"api_calls" integer DEFAULT 0 NOT NULL,
	"ai_calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_tenant_id_period_pk" PRIMARY KEY("tenant_id","period")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"citizen_id" text,
	"can_second_approve" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_code" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citizens" ADD CONSTRAINT "citizens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citizens" ADD CONSTRAINT "citizens_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "cases_tenant_status_idx" ON "cases" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "cases_citizen_idx" ON "cases" USING btree ("citizen_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_client_ref_uq" ON "cases" USING btree ("created_by","client_ref");--> statement-breakpoint
CREATE INDEX "citizens_cnic_idx" ON "citizens" USING btree ("cnic");--> statement-breakpoint
CREATE INDEX "citizens_name_key_idx" ON "citizens" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "consents_citizen_idx" ON "consents" USING btree ("citizen_id");--> statement-breakpoint
CREATE INDEX "decisions_case_idx" ON "decisions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "documents_case_idx" ON "documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mock_raast_payout_uq" ON "mock_raast_ledger" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "notices_citizen_idx" ON "notices" USING btree ("citizen_id");--> statement-breakpoint
CREATE INDEX "notices_code_idx" ON "notices" USING btree ("code");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_citizen_idx" ON "notifications" USING btree ("citizen_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_case_uq" ON "payouts" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_sets_tenant_version_uq" ON "rule_sets" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE INDEX "scam_reports_created_idx" ON "scam_reports" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");