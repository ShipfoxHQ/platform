CREATE TABLE IF NOT EXISTS "agent_data_keys" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"wrapped_dek" text NOT NULL,
	"kek_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "retired_at" timestamp with time zone;--> statement-breakpoint
UPDATE "agent_sessions" SET "retired_at" = now() WHERE "retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_retired_at_idx" ON "agent_sessions" USING btree ("retired_at") WHERE "retired_at" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_claimed_by_step_attempt_idx" ON "agent_sessions" USING btree ("claimed_by_step_attempt") WHERE "claimed_by_step_attempt" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_claimed_at_partial_idx" ON "agent_sessions" USING btree ("claimed_at") WHERE "claimed_by_step_attempt" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_head_object_key_idx" ON "agent_sessions" USING btree ("head_object_key") WHERE "head_object_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_updated_at_id_idx" ON "agent_sessions" USING btree ("updated_at","id");
