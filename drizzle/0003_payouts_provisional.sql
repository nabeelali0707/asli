ALTER TABLE "payouts" ADD COLUMN "provisional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "cooling_off_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "cancelled_reason" text;