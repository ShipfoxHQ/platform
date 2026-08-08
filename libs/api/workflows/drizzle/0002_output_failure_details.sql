ALTER TABLE "workflows_job_executions" ADD COLUMN "status_reason_message" text;--> statement-breakpoint
ALTER TYPE "public"."workflows_job_status_reason" ADD VALUE 'output_too_large' BEFORE 'step_failed';
