CREATE TABLE "usage_job_executions" (
	"job_execution_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"workflow_run_attempt_id" uuid NOT NULL,
	"workspace_id" uuid,
	"project_id" uuid,
	"definition_id" uuid,
	"job_key" text,
	"run_number" integer,
	"requested_labels" text[],
	"runner_labels" text[],
	"template_key" text,
	"provisioner_id" uuid,
	"provisioner_scope" text,
	"provider_kind" text,
	"launch_kind" text,
	"runner_class" text,
	"runner_arch" text,
	"runner_cpu" text,
	"managed" boolean,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"lease_expired_at" timestamp with time zone,
	"status" text,
	"status_reason" text,
	"cancellation_reason" text,
	"duration_seconds" double precision,
	"state" text,
	"recorded_at" timestamp with time zone
) PARTITION BY RANGE ("recorded_at");
--> statement-breakpoint
CREATE TABLE "usage_inference_segments" (
	"id" uuid NOT NULL DEFAULT uuidv7(),
	"segment_key" text NOT NULL,
	"source" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"workflow_run_attempt_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"job_execution_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"step_attempt_id" uuid NOT NULL,
	"upstream" text NOT NULL,
	"model" text NOT NULL,
	"dialect" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"request_count" bigint NOT NULL,
	"input_tokens" bigint NOT NULL,
	"output_tokens" bigint NOT NULL,
	"cache_creation_tokens" bigint NOT NULL,
	"cache_read_tokens" bigint NOT NULL,
	"reasoning_tokens" bigint NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
) PARTITION BY RANGE ("recorded_at");
--> statement-breakpoint
DO $$
DECLARE
	month_start date := DATE '2020-01-01';
	month_end date;
	suffix text;
BEGIN
	WHILE month_start < DATE '2032-01-01' LOOP
		month_end := (month_start + INTERVAL '1 month')::date;
		suffix := to_char(month_start, 'YYYY_MM');
		EXECUTE format(
			'CREATE TABLE %I PARTITION OF usage_job_executions FOR VALUES FROM (%L) TO (%L)',
			'usage_job_executions_' || suffix,
			month_start,
			month_end
		);
		EXECUTE format(
			'ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY (job_execution_id, recorded_at)',
			'usage_job_executions_' || suffix,
			'usage_job_executions_' || suffix || '_pkey'
		);
		EXECUTE format(
			'CREATE TABLE %I PARTITION OF usage_inference_segments FOR VALUES FROM (%L) TO (%L)',
			'usage_inference_segments_' || suffix,
			month_start,
			month_end
		);
		EXECUTE format(
			'ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY (id, recorded_at)',
			'usage_inference_segments_' || suffix,
			'usage_inference_segments_' || suffix || '_pkey'
		);
		month_start := month_end;
	END LOOP;
END $$;
--> statement-breakpoint
CREATE TABLE "usage_job_executions_unrecorded" PARTITION OF "usage_job_executions" DEFAULT;
ALTER TABLE "usage_job_executions_unrecorded" ADD CONSTRAINT "usage_job_executions_unrecorded_pkey" PRIMARY KEY ("job_execution_id");
--> statement-breakpoint
CREATE TABLE "usage_inference_segments_default" PARTITION OF "usage_inference_segments" DEFAULT;
ALTER TABLE "usage_inference_segments_default" ADD CONSTRAINT "usage_inference_segments_default_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
CREATE INDEX "usage_job_executions_workspace_recorded_idx" ON "usage_job_executions" USING btree ("workspace_id", "recorded_at");
CREATE INDEX "usage_job_executions_workflow_run_idx" ON "usage_job_executions" USING btree ("workflow_run_id");
CREATE INDEX "usage_job_executions_job_execution_idx" ON "usage_job_executions" USING btree ("job_execution_id");
CREATE UNIQUE INDEX "usage_inference_segments_segment_key_recorded_unique" ON "usage_inference_segments" USING btree ("segment_key", "recorded_at");
CREATE INDEX "usage_inference_segments_workspace_recorded_idx" ON "usage_inference_segments" USING btree ("workspace_id", "recorded_at");
CREATE INDEX "usage_inference_segments_workflow_run_idx" ON "usage_inference_segments" USING btree ("workflow_run_id");
CREATE INDEX "usage_inference_segments_job_execution_idx" ON "usage_inference_segments" USING btree ("job_execution_id");
CREATE INDEX "usage_inference_segments_step_attempt_idx" ON "usage_inference_segments" USING btree ("step_attempt_id");
--> statement-breakpoint
CREATE TABLE "usage_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"ordering_key" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"dispatch_attempts" integer DEFAULT 0 NOT NULL,
	"next_dispatch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_dispatch_error" jsonb,
	"last_dispatch_failed_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "usage_outbox_pending_idx" ON "usage_outbox" USING btree ("next_dispatch_at", "created_at") WHERE "dispatched_at" IS NULL AND "dead_lettered_at" IS NULL;
CREATE INDEX "usage_outbox_dispatched_retention_idx" ON "usage_outbox" USING btree ("dispatched_at", "id") WHERE "dispatched_at" IS NOT NULL;
