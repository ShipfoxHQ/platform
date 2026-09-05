ALTER TABLE "workflows_job_executions" ALTER COLUMN "trigger_events" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ALTER COLUMN "trigger_events" DROP NOT NULL;