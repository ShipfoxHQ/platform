CREATE TYPE "public"."workflows_job_listener_event_outcome" AS ENUM('pending', 'consumed', 'honored', 'rejected', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."workflows_job_listener_event_outcome_reason" AS ENUM('payload_too_large', 'until', 'timeout', 'max_executions', 'cancelled');--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" DROP CONSTRAINT "workflows_job_listener_events_consumed_by_execution_id_workflows_job_executions_id_fk";
--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ALTER COLUMN "payload" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD COLUMN "outcome" "workflows_job_listener_event_outcome" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD COLUMN "outcome_reason" "workflows_job_listener_event_outcome_reason";--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD COLUMN "stored_payload_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD COLUMN "normalized_event_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD CONSTRAINT "workflows_job_listener_events_consumed_by_execution_id_workflows_job_executions_id_fk" FOREIGN KEY ("consumed_by_execution_id") REFERENCES "public"."workflows_job_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_job_listener_events_pending_order_idx" ON "workflows_job_listener_events" USING btree ("job_id","received_at","id") WHERE "workflows_job_listener_events"."consumed_by_execution_id" IS NULL AND "workflows_job_listener_events"."outcome" = 'pending';--> statement-breakpoint
CREATE INDEX "workflows_job_listener_events_consumed_order_idx" ON "workflows_job_listener_events" USING btree ("consumed_by_execution_id","received_at","id") WHERE "workflows_job_listener_events"."consumed_by_execution_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD CONSTRAINT "workflows_job_listener_events_byte_counts_ck" CHECK ("workflows_job_listener_events"."stored_payload_bytes" >= 0 AND "workflows_job_listener_events"."normalized_event_bytes" >= 0);--> statement-breakpoint
