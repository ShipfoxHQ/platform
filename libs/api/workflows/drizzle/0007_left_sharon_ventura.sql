CREATE TYPE "public"."workflows_job_listener_event_outcome" AS ENUM('pending', 'consumed', 'honored', 'rejected', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."workflows_job_listener_event_outcome_reason" AS ENUM('payload_too_large', 'until', 'timeout', 'max_executions', 'cancelled');--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" DROP CONSTRAINT "workflows_job_listener_events_consumed_by_execution_id_workflows_job_executions_id_fk";
--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ALTER COLUMN "payload" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD COLUMN "outcome" "workflows_job_listener_event_outcome" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD COLUMN "outcome_reason" "workflows_job_listener_event_outcome_reason";--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD COLUMN "stored_payload_bytes" integer;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD COLUMN "normalized_event_bytes" integer;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD CONSTRAINT "workflows_job_listener_events_consumed_by_execution_id_workflows_job_executions_id_fk" FOREIGN KEY ("consumed_by_execution_id") REFERENCES "public"."workflows_job_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "workflows_job_listener_events"
SET
	"stored_payload_bytes" = octet_length("payload"::text),
	"normalized_event_bytes" = octet_length(
		jsonb_build_array(
			jsonb_build_object(
				'source', "source",
				'event', "event",
				'delivery_id', "delivery_id",
				'received_at', to_char("received_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
				'project', "trigger_reference" -> 'project',
				'repository', "trigger_reference" ->> 'repository',
				'ref', "trigger_reference" ->> 'ref',
				'commit', "trigger_reference" ->> 'commit',
				'data', "payload"
			)
		)::text
	);--> statement-breakpoint
UPDATE "workflows_job_listener_events"
SET "outcome" = 'consumed', "outcome_reason" = NULL
WHERE "consumed_by_execution_id" IS NOT NULL;--> statement-breakpoint
DO $$
DECLARE
	missing_resolution_reasons integer;
BEGIN
	SELECT count(*)
	INTO missing_resolution_reasons
	FROM "workflows_job_listener_events" AS event
	INNER JOIN "workflows_jobs" AS job ON job."id" = event."job_id"
	WHERE event."consumed_by_execution_id" IS NULL
	  AND job."listener_status" = 'resolved'
	  AND job."resolution_reason" IS NULL;

	IF missing_resolution_reasons > 0 THEN
		RAISE EXCEPTION 'Cannot backfill listener event outcomes: % unconsumed events belong to resolved jobs without a resolution reason', missing_resolution_reasons;
	END IF;
END $$;--> statement-breakpoint
UPDATE "workflows_job_listener_events" AS event
SET "outcome" = 'honored', "outcome_reason" = NULL
FROM "workflows_jobs" AS job
WHERE event."job_id" = job."id"
  AND event."consumed_by_execution_id" IS NULL
  AND event."disposition" = 'resolve'
  AND job."listener_status" = 'resolved'
  AND job."resolution_reason" = 'until';--> statement-breakpoint
UPDATE "workflows_job_listener_events" AS event
SET "outcome" = 'abandoned',
	"outcome_reason" = job."resolution_reason"::text::"workflows_job_listener_event_outcome_reason"
FROM "workflows_jobs" AS job
WHERE event."job_id" = job."id"
  AND event."consumed_by_execution_id" IS NULL
  AND event."outcome" = 'pending'
  AND job."listener_status" = 'resolved';--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ALTER COLUMN "stored_payload_bytes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ALTER COLUMN "normalized_event_bytes" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "workflows_job_listener_events_pending_order_idx" ON "workflows_job_listener_events" USING btree ("job_id","received_at","id") WHERE "workflows_job_listener_events"."consumed_by_execution_id" IS NULL AND "workflows_job_listener_events"."outcome" = 'pending';--> statement-breakpoint
CREATE INDEX "workflows_job_listener_events_consumed_order_idx" ON "workflows_job_listener_events" USING btree ("consumed_by_execution_id","received_at","id") WHERE "workflows_job_listener_events"."consumed_by_execution_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD CONSTRAINT "workflows_job_listener_events_byte_counts_ck" CHECK ("workflows_job_listener_events"."stored_payload_bytes" >= 0 AND "workflows_job_listener_events"."normalized_event_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD CONSTRAINT "workflows_job_listener_events_outcome_consistency_ck" CHECK (COALESCE((
        ("workflows_job_listener_events"."outcome" = 'pending'
          AND "workflows_job_listener_events"."disposition" IN ('fire', 'resolve')
          AND "workflows_job_listener_events"."consumed_by_execution_id" IS NULL
          AND "workflows_job_listener_events"."payload" IS NOT NULL
          AND "workflows_job_listener_events"."outcome_reason" IS NULL)
        OR ("workflows_job_listener_events"."outcome" = 'consumed'
          AND "workflows_job_listener_events"."disposition" = 'fire'
          AND "workflows_job_listener_events"."consumed_by_execution_id" IS NOT NULL
          AND "workflows_job_listener_events"."payload" IS NOT NULL
          AND "workflows_job_listener_events"."outcome_reason" IS NULL)
        OR ("workflows_job_listener_events"."outcome" = 'honored'
          AND "workflows_job_listener_events"."disposition" = 'resolve'
          AND "workflows_job_listener_events"."consumed_by_execution_id" IS NULL
          AND "workflows_job_listener_events"."payload" IS NOT NULL
          AND "workflows_job_listener_events"."outcome_reason" IS NULL)
        OR ("workflows_job_listener_events"."outcome" = 'rejected'
          AND "workflows_job_listener_events"."disposition" = 'fire'
          AND "workflows_job_listener_events"."consumed_by_execution_id" IS NULL
          AND "workflows_job_listener_events"."payload" IS NULL
          AND "workflows_job_listener_events"."outcome_reason" = 'payload_too_large')
        OR ("workflows_job_listener_events"."outcome" = 'abandoned'
          AND "workflows_job_listener_events"."disposition" IN ('fire', 'resolve')
          AND "workflows_job_listener_events"."consumed_by_execution_id" IS NULL
          AND "workflows_job_listener_events"."payload" IS NOT NULL
          AND "workflows_job_listener_events"."outcome_reason" IN ('until', 'timeout', 'max_executions', 'cancelled'))
      ), false));
