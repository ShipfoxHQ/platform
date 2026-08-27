CREATE TYPE "public"."runners_termination_reason" AS ENUM('registration-deadline', 'activation-timeout', 'runner-unresponsive', 'lease-expired', 'session-exhausted', 'stopping-timeout', 'provider-health-failed', 'job-cancelled', 'job-timeout', 'terminal-state');--> statement-breakpoint
ALTER TABLE "runners_runner_instances" ADD COLUMN "termination_authorized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runners_runner_instances" ADD COLUMN "termination_reason" "public"."runners_termination_reason";
