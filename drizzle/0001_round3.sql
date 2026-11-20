CREATE TABLE "ai_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"kind" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"citizen_id" text,
	"input" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"citizen_view" jsonb NOT NULL,
	"auditor_view" jsonb NOT NULL,
	"model" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"replay_of" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "break_glass_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"officer_id" text NOT NULL,
	"citizen_id" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_alias_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"citizen_id" text NOT NULL,
	"old_alias" text,
	"new_alias" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text NOT NULL,
	"approved_by" text,
	"effective_at" timestamp with time zone,
	"frozen_at" timestamp with time zone,
	"frozen_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"payout_id" text NOT NULL,
	"citizen_id" text NOT NULL,
	"expected_amount" integer NOT NULL,
	"confirmed_amount" integer,
	"status" text NOT NULL,
	"via" text NOT NULL,
	"complaint_case_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"case_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_models" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"model" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"dataset_hash" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "chain_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "dhash" text;--> statement-breakpoint
CREATE INDEX "ai_decisions_subject_idx" ON "ai_decisions" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "ai_decisions_kind_idx" ON "ai_decisions" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "pipeline_runs_case_idx" ON "pipeline_runs" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "pipeline_runs_status_idx" ON "pipeline_runs" USING btree ("status");