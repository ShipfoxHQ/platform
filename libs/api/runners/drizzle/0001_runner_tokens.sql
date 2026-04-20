CREATE TABLE "runners_runner_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"hashed_token" text NOT NULL,
	"prefix" text NOT NULL,
	"name" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ADD COLUMN "runner_token_id" uuid DEFAULT uuidv7() NOT NULL;--> statement-breakpoint
ALTER TABLE "runners_running_jobs" DROP COLUMN "runner_token";--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ALTER COLUMN "runner_token_id" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "runners_pending_jobs_workspace_created_idx" ON "runners_pending_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runners_runner_tokens_hashed_token_unique" ON "runners_runner_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "runners_runner_tokens_workspace_id_idx" ON "runners_runner_tokens" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "runners_runner_tokens_active_lookup_idx" ON "runners_runner_tokens" USING btree ("hashed_token","revoked_at","expires_at");
