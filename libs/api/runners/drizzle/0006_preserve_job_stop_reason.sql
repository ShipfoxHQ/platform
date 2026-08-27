CREATE TYPE "public"."runners_job_stop_reason" AS ENUM('run_cancelled', 'timed_out');--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ADD COLUMN "cancellation_reason" "public"."runners_job_stop_reason";
