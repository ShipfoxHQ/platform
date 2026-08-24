CREATE TABLE "agent_data_keys" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"wrapped_dek" text NOT NULL,
	"kek_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "agent_sessions_retired_at_idx" ON "agent_sessions" USING btree ("retired_at") WHERE "retired_at" is not null;
