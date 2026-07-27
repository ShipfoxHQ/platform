ALTER TABLE "logs_attempt_streams" ADD COLUMN "claude_has_init" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "logs_attempt_streams" ADD COLUMN "claude_session_id" text;--> statement-breakpoint
ALTER TABLE "logs_attempt_streams" ADD COLUMN "claude_turn" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "logs_attempt_streams" ADD COLUMN "claude_pending_result" jsonb;
