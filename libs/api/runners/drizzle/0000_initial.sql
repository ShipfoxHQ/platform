CREATE TABLE "runners_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runners_pending_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runners_pending_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "runners_running_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"runner_token" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runners_running_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE INDEX "runners_outbox_pending_idx" ON "runners_outbox" USING btree ("created_at") WHERE "dispatched_at" IS NULL;--> statement-breakpoint
CREATE INDEX "runners_pending_jobs_created_idx" ON "runners_pending_jobs" USING btree ("created_at");
