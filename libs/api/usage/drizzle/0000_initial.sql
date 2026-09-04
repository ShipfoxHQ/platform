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
CREATE TABLE "usage_job_executions_2020_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-01-01 00:00:00+00') TO ('2020-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_01" ADD CONSTRAINT "usage_job_executions_2020_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-01-01 00:00:00+00') TO ('2020-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_01" ADD CONSTRAINT "usage_inference_segments_2020_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2020_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-02-01 00:00:00+00') TO ('2020-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_02" ADD CONSTRAINT "usage_job_executions_2020_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-02-01 00:00:00+00') TO ('2020-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_02" ADD CONSTRAINT "usage_inference_segments_2020_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2020_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-03-01 00:00:00+00') TO ('2020-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_03" ADD CONSTRAINT "usage_job_executions_2020_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-03-01 00:00:00+00') TO ('2020-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_03" ADD CONSTRAINT "usage_inference_segments_2020_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2020_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-04-01 00:00:00+00') TO ('2020-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_04" ADD CONSTRAINT "usage_job_executions_2020_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-04-01 00:00:00+00') TO ('2020-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_04" ADD CONSTRAINT "usage_inference_segments_2020_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2020_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-05-01 00:00:00+00') TO ('2020-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_05" ADD CONSTRAINT "usage_job_executions_2020_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-05-01 00:00:00+00') TO ('2020-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_05" ADD CONSTRAINT "usage_inference_segments_2020_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2020_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-06-01 00:00:00+00') TO ('2020-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_06" ADD CONSTRAINT "usage_job_executions_2020_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-06-01 00:00:00+00') TO ('2020-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_06" ADD CONSTRAINT "usage_inference_segments_2020_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2020_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-07-01 00:00:00+00') TO ('2020-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_07" ADD CONSTRAINT "usage_job_executions_2020_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-07-01 00:00:00+00') TO ('2020-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_07" ADD CONSTRAINT "usage_inference_segments_2020_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2020_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-08-01 00:00:00+00') TO ('2020-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_08" ADD CONSTRAINT "usage_job_executions_2020_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-08-01 00:00:00+00') TO ('2020-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_08" ADD CONSTRAINT "usage_inference_segments_2020_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2020_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-09-01 00:00:00+00') TO ('2020-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_09" ADD CONSTRAINT "usage_job_executions_2020_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-09-01 00:00:00+00') TO ('2020-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_09" ADD CONSTRAINT "usage_inference_segments_2020_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2020_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-10-01 00:00:00+00') TO ('2020-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_10" ADD CONSTRAINT "usage_job_executions_2020_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-10-01 00:00:00+00') TO ('2020-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_10" ADD CONSTRAINT "usage_inference_segments_2020_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2020_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-11-01 00:00:00+00') TO ('2020-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_11" ADD CONSTRAINT "usage_job_executions_2020_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-11-01 00:00:00+00') TO ('2020-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_11" ADD CONSTRAINT "usage_inference_segments_2020_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2020_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2020-12-01 00:00:00+00') TO ('2021-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2020_12" ADD CONSTRAINT "usage_job_executions_2020_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2020_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2020-12-01 00:00:00+00') TO ('2021-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2020_12" ADD CONSTRAINT "usage_inference_segments_2020_12_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-01-01 00:00:00+00') TO ('2021-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_01" ADD CONSTRAINT "usage_job_executions_2021_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-01-01 00:00:00+00') TO ('2021-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_01" ADD CONSTRAINT "usage_inference_segments_2021_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-02-01 00:00:00+00') TO ('2021-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_02" ADD CONSTRAINT "usage_job_executions_2021_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-02-01 00:00:00+00') TO ('2021-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_02" ADD CONSTRAINT "usage_inference_segments_2021_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-03-01 00:00:00+00') TO ('2021-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_03" ADD CONSTRAINT "usage_job_executions_2021_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-03-01 00:00:00+00') TO ('2021-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_03" ADD CONSTRAINT "usage_inference_segments_2021_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-04-01 00:00:00+00') TO ('2021-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_04" ADD CONSTRAINT "usage_job_executions_2021_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-04-01 00:00:00+00') TO ('2021-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_04" ADD CONSTRAINT "usage_inference_segments_2021_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-05-01 00:00:00+00') TO ('2021-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_05" ADD CONSTRAINT "usage_job_executions_2021_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-05-01 00:00:00+00') TO ('2021-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_05" ADD CONSTRAINT "usage_inference_segments_2021_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-06-01 00:00:00+00') TO ('2021-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_06" ADD CONSTRAINT "usage_job_executions_2021_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-06-01 00:00:00+00') TO ('2021-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_06" ADD CONSTRAINT "usage_inference_segments_2021_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-07-01 00:00:00+00') TO ('2021-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_07" ADD CONSTRAINT "usage_job_executions_2021_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-07-01 00:00:00+00') TO ('2021-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_07" ADD CONSTRAINT "usage_inference_segments_2021_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-08-01 00:00:00+00') TO ('2021-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_08" ADD CONSTRAINT "usage_job_executions_2021_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-08-01 00:00:00+00') TO ('2021-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_08" ADD CONSTRAINT "usage_inference_segments_2021_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-09-01 00:00:00+00') TO ('2021-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_09" ADD CONSTRAINT "usage_job_executions_2021_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-09-01 00:00:00+00') TO ('2021-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_09" ADD CONSTRAINT "usage_inference_segments_2021_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-10-01 00:00:00+00') TO ('2021-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_10" ADD CONSTRAINT "usage_job_executions_2021_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-10-01 00:00:00+00') TO ('2021-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_10" ADD CONSTRAINT "usage_inference_segments_2021_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-11-01 00:00:00+00') TO ('2021-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_11" ADD CONSTRAINT "usage_job_executions_2021_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-11-01 00:00:00+00') TO ('2021-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_11" ADD CONSTRAINT "usage_inference_segments_2021_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2021_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2021-12-01 00:00:00+00') TO ('2022-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2021_12" ADD CONSTRAINT "usage_job_executions_2021_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2021_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2021-12-01 00:00:00+00') TO ('2022-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2021_12" ADD CONSTRAINT "usage_inference_segments_2021_12_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-01-01 00:00:00+00') TO ('2022-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_01" ADD CONSTRAINT "usage_job_executions_2022_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-01-01 00:00:00+00') TO ('2022-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_01" ADD CONSTRAINT "usage_inference_segments_2022_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-02-01 00:00:00+00') TO ('2022-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_02" ADD CONSTRAINT "usage_job_executions_2022_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-02-01 00:00:00+00') TO ('2022-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_02" ADD CONSTRAINT "usage_inference_segments_2022_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-03-01 00:00:00+00') TO ('2022-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_03" ADD CONSTRAINT "usage_job_executions_2022_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-03-01 00:00:00+00') TO ('2022-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_03" ADD CONSTRAINT "usage_inference_segments_2022_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-04-01 00:00:00+00') TO ('2022-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_04" ADD CONSTRAINT "usage_job_executions_2022_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-04-01 00:00:00+00') TO ('2022-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_04" ADD CONSTRAINT "usage_inference_segments_2022_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-05-01 00:00:00+00') TO ('2022-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_05" ADD CONSTRAINT "usage_job_executions_2022_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-05-01 00:00:00+00') TO ('2022-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_05" ADD CONSTRAINT "usage_inference_segments_2022_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-06-01 00:00:00+00') TO ('2022-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_06" ADD CONSTRAINT "usage_job_executions_2022_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-06-01 00:00:00+00') TO ('2022-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_06" ADD CONSTRAINT "usage_inference_segments_2022_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-07-01 00:00:00+00') TO ('2022-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_07" ADD CONSTRAINT "usage_job_executions_2022_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-07-01 00:00:00+00') TO ('2022-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_07" ADD CONSTRAINT "usage_inference_segments_2022_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-08-01 00:00:00+00') TO ('2022-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_08" ADD CONSTRAINT "usage_job_executions_2022_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-08-01 00:00:00+00') TO ('2022-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_08" ADD CONSTRAINT "usage_inference_segments_2022_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-09-01 00:00:00+00') TO ('2022-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_09" ADD CONSTRAINT "usage_job_executions_2022_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-09-01 00:00:00+00') TO ('2022-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_09" ADD CONSTRAINT "usage_inference_segments_2022_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-10-01 00:00:00+00') TO ('2022-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_10" ADD CONSTRAINT "usage_job_executions_2022_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-10-01 00:00:00+00') TO ('2022-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_10" ADD CONSTRAINT "usage_inference_segments_2022_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-11-01 00:00:00+00') TO ('2022-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_11" ADD CONSTRAINT "usage_job_executions_2022_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-11-01 00:00:00+00') TO ('2022-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_11" ADD CONSTRAINT "usage_inference_segments_2022_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2022_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2022-12-01 00:00:00+00') TO ('2023-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2022_12" ADD CONSTRAINT "usage_job_executions_2022_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2022_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2022-12-01 00:00:00+00') TO ('2023-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2022_12" ADD CONSTRAINT "usage_inference_segments_2022_12_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-01-01 00:00:00+00') TO ('2023-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_01" ADD CONSTRAINT "usage_job_executions_2023_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-01-01 00:00:00+00') TO ('2023-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_01" ADD CONSTRAINT "usage_inference_segments_2023_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-02-01 00:00:00+00') TO ('2023-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_02" ADD CONSTRAINT "usage_job_executions_2023_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-02-01 00:00:00+00') TO ('2023-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_02" ADD CONSTRAINT "usage_inference_segments_2023_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-03-01 00:00:00+00') TO ('2023-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_03" ADD CONSTRAINT "usage_job_executions_2023_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-03-01 00:00:00+00') TO ('2023-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_03" ADD CONSTRAINT "usage_inference_segments_2023_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-04-01 00:00:00+00') TO ('2023-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_04" ADD CONSTRAINT "usage_job_executions_2023_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-04-01 00:00:00+00') TO ('2023-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_04" ADD CONSTRAINT "usage_inference_segments_2023_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-05-01 00:00:00+00') TO ('2023-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_05" ADD CONSTRAINT "usage_job_executions_2023_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-05-01 00:00:00+00') TO ('2023-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_05" ADD CONSTRAINT "usage_inference_segments_2023_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-06-01 00:00:00+00') TO ('2023-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_06" ADD CONSTRAINT "usage_job_executions_2023_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-06-01 00:00:00+00') TO ('2023-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_06" ADD CONSTRAINT "usage_inference_segments_2023_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-07-01 00:00:00+00') TO ('2023-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_07" ADD CONSTRAINT "usage_job_executions_2023_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-07-01 00:00:00+00') TO ('2023-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_07" ADD CONSTRAINT "usage_inference_segments_2023_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-08-01 00:00:00+00') TO ('2023-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_08" ADD CONSTRAINT "usage_job_executions_2023_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-08-01 00:00:00+00') TO ('2023-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_08" ADD CONSTRAINT "usage_inference_segments_2023_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-09-01 00:00:00+00') TO ('2023-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_09" ADD CONSTRAINT "usage_job_executions_2023_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-09-01 00:00:00+00') TO ('2023-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_09" ADD CONSTRAINT "usage_inference_segments_2023_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-10-01 00:00:00+00') TO ('2023-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_10" ADD CONSTRAINT "usage_job_executions_2023_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-10-01 00:00:00+00') TO ('2023-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_10" ADD CONSTRAINT "usage_inference_segments_2023_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-11-01 00:00:00+00') TO ('2023-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_11" ADD CONSTRAINT "usage_job_executions_2023_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-11-01 00:00:00+00') TO ('2023-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_11" ADD CONSTRAINT "usage_inference_segments_2023_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2023_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2023-12-01 00:00:00+00') TO ('2024-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2023_12" ADD CONSTRAINT "usage_job_executions_2023_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2023_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2023-12-01 00:00:00+00') TO ('2024-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2023_12" ADD CONSTRAINT "usage_inference_segments_2023_12_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-01-01 00:00:00+00') TO ('2024-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_01" ADD CONSTRAINT "usage_job_executions_2024_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-01-01 00:00:00+00') TO ('2024-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_01" ADD CONSTRAINT "usage_inference_segments_2024_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-02-01 00:00:00+00') TO ('2024-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_02" ADD CONSTRAINT "usage_job_executions_2024_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-02-01 00:00:00+00') TO ('2024-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_02" ADD CONSTRAINT "usage_inference_segments_2024_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-03-01 00:00:00+00') TO ('2024-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_03" ADD CONSTRAINT "usage_job_executions_2024_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-03-01 00:00:00+00') TO ('2024-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_03" ADD CONSTRAINT "usage_inference_segments_2024_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-04-01 00:00:00+00') TO ('2024-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_04" ADD CONSTRAINT "usage_job_executions_2024_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-04-01 00:00:00+00') TO ('2024-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_04" ADD CONSTRAINT "usage_inference_segments_2024_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-05-01 00:00:00+00') TO ('2024-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_05" ADD CONSTRAINT "usage_job_executions_2024_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-05-01 00:00:00+00') TO ('2024-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_05" ADD CONSTRAINT "usage_inference_segments_2024_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-06-01 00:00:00+00') TO ('2024-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_06" ADD CONSTRAINT "usage_job_executions_2024_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-06-01 00:00:00+00') TO ('2024-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_06" ADD CONSTRAINT "usage_inference_segments_2024_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-07-01 00:00:00+00') TO ('2024-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_07" ADD CONSTRAINT "usage_job_executions_2024_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-07-01 00:00:00+00') TO ('2024-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_07" ADD CONSTRAINT "usage_inference_segments_2024_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-08-01 00:00:00+00') TO ('2024-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_08" ADD CONSTRAINT "usage_job_executions_2024_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-08-01 00:00:00+00') TO ('2024-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_08" ADD CONSTRAINT "usage_inference_segments_2024_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-09-01 00:00:00+00') TO ('2024-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_09" ADD CONSTRAINT "usage_job_executions_2024_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-09-01 00:00:00+00') TO ('2024-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_09" ADD CONSTRAINT "usage_inference_segments_2024_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-10-01 00:00:00+00') TO ('2024-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_10" ADD CONSTRAINT "usage_job_executions_2024_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-10-01 00:00:00+00') TO ('2024-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_10" ADD CONSTRAINT "usage_inference_segments_2024_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-11-01 00:00:00+00') TO ('2024-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_11" ADD CONSTRAINT "usage_job_executions_2024_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-11-01 00:00:00+00') TO ('2024-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_11" ADD CONSTRAINT "usage_inference_segments_2024_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2024_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2024-12-01 00:00:00+00') TO ('2025-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2024_12" ADD CONSTRAINT "usage_job_executions_2024_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2024_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2024-12-01 00:00:00+00') TO ('2025-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2024_12" ADD CONSTRAINT "usage_inference_segments_2024_12_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2025-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_01" ADD CONSTRAINT "usage_job_executions_2025_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2025-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_01" ADD CONSTRAINT "usage_inference_segments_2025_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-02-01 00:00:00+00') TO ('2025-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_02" ADD CONSTRAINT "usage_job_executions_2025_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-02-01 00:00:00+00') TO ('2025-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_02" ADD CONSTRAINT "usage_inference_segments_2025_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-03-01 00:00:00+00') TO ('2025-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_03" ADD CONSTRAINT "usage_job_executions_2025_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-03-01 00:00:00+00') TO ('2025-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_03" ADD CONSTRAINT "usage_inference_segments_2025_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-04-01 00:00:00+00') TO ('2025-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_04" ADD CONSTRAINT "usage_job_executions_2025_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-04-01 00:00:00+00') TO ('2025-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_04" ADD CONSTRAINT "usage_inference_segments_2025_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-05-01 00:00:00+00') TO ('2025-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_05" ADD CONSTRAINT "usage_job_executions_2025_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-05-01 00:00:00+00') TO ('2025-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_05" ADD CONSTRAINT "usage_inference_segments_2025_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-06-01 00:00:00+00') TO ('2025-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_06" ADD CONSTRAINT "usage_job_executions_2025_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-06-01 00:00:00+00') TO ('2025-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_06" ADD CONSTRAINT "usage_inference_segments_2025_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-07-01 00:00:00+00') TO ('2025-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_07" ADD CONSTRAINT "usage_job_executions_2025_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-07-01 00:00:00+00') TO ('2025-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_07" ADD CONSTRAINT "usage_inference_segments_2025_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-08-01 00:00:00+00') TO ('2025-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_08" ADD CONSTRAINT "usage_job_executions_2025_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-08-01 00:00:00+00') TO ('2025-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_08" ADD CONSTRAINT "usage_inference_segments_2025_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-09-01 00:00:00+00') TO ('2025-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_09" ADD CONSTRAINT "usage_job_executions_2025_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-09-01 00:00:00+00') TO ('2025-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_09" ADD CONSTRAINT "usage_inference_segments_2025_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-10-01 00:00:00+00') TO ('2025-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_10" ADD CONSTRAINT "usage_job_executions_2025_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-10-01 00:00:00+00') TO ('2025-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_10" ADD CONSTRAINT "usage_inference_segments_2025_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-11-01 00:00:00+00') TO ('2025-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_11" ADD CONSTRAINT "usage_job_executions_2025_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-11-01 00:00:00+00') TO ('2025-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_11" ADD CONSTRAINT "usage_inference_segments_2025_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2025_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2025-12-01 00:00:00+00') TO ('2026-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2025_12" ADD CONSTRAINT "usage_job_executions_2025_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2025_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2025-12-01 00:00:00+00') TO ('2026-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2025_12" ADD CONSTRAINT "usage_inference_segments_2025_12_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_01" ADD CONSTRAINT "usage_job_executions_2026_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_01" ADD CONSTRAINT "usage_inference_segments_2026_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-02-01 00:00:00+00') TO ('2026-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_02" ADD CONSTRAINT "usage_job_executions_2026_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-02-01 00:00:00+00') TO ('2026-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_02" ADD CONSTRAINT "usage_inference_segments_2026_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-03-01 00:00:00+00') TO ('2026-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_03" ADD CONSTRAINT "usage_job_executions_2026_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-03-01 00:00:00+00') TO ('2026-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_03" ADD CONSTRAINT "usage_inference_segments_2026_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_04" ADD CONSTRAINT "usage_job_executions_2026_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_04" ADD CONSTRAINT "usage_inference_segments_2026_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_05" ADD CONSTRAINT "usage_job_executions_2026_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_05" ADD CONSTRAINT "usage_inference_segments_2026_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_06" ADD CONSTRAINT "usage_job_executions_2026_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_06" ADD CONSTRAINT "usage_inference_segments_2026_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_07" ADD CONSTRAINT "usage_job_executions_2026_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_07" ADD CONSTRAINT "usage_inference_segments_2026_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_08" ADD CONSTRAINT "usage_job_executions_2026_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_08" ADD CONSTRAINT "usage_inference_segments_2026_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_09" ADD CONSTRAINT "usage_job_executions_2026_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_09" ADD CONSTRAINT "usage_inference_segments_2026_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_10" ADD CONSTRAINT "usage_job_executions_2026_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_10" ADD CONSTRAINT "usage_inference_segments_2026_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_11" ADD CONSTRAINT "usage_job_executions_2026_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_11" ADD CONSTRAINT "usage_inference_segments_2026_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2026_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2026_12" ADD CONSTRAINT "usage_job_executions_2026_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2026_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2026_12" ADD CONSTRAINT "usage_inference_segments_2026_12_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_01" ADD CONSTRAINT "usage_job_executions_2027_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_01" ADD CONSTRAINT "usage_inference_segments_2027_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-02-01 00:00:00+00') TO ('2027-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_02" ADD CONSTRAINT "usage_job_executions_2027_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-02-01 00:00:00+00') TO ('2027-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_02" ADD CONSTRAINT "usage_inference_segments_2027_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-03-01 00:00:00+00') TO ('2027-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_03" ADD CONSTRAINT "usage_job_executions_2027_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-03-01 00:00:00+00') TO ('2027-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_03" ADD CONSTRAINT "usage_inference_segments_2027_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-04-01 00:00:00+00') TO ('2027-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_04" ADD CONSTRAINT "usage_job_executions_2027_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-04-01 00:00:00+00') TO ('2027-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_04" ADD CONSTRAINT "usage_inference_segments_2027_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-05-01 00:00:00+00') TO ('2027-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_05" ADD CONSTRAINT "usage_job_executions_2027_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-05-01 00:00:00+00') TO ('2027-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_05" ADD CONSTRAINT "usage_inference_segments_2027_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-06-01 00:00:00+00') TO ('2027-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_06" ADD CONSTRAINT "usage_job_executions_2027_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-06-01 00:00:00+00') TO ('2027-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_06" ADD CONSTRAINT "usage_inference_segments_2027_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-07-01 00:00:00+00') TO ('2027-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_07" ADD CONSTRAINT "usage_job_executions_2027_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-07-01 00:00:00+00') TO ('2027-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_07" ADD CONSTRAINT "usage_inference_segments_2027_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-08-01 00:00:00+00') TO ('2027-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_08" ADD CONSTRAINT "usage_job_executions_2027_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-08-01 00:00:00+00') TO ('2027-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_08" ADD CONSTRAINT "usage_inference_segments_2027_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-09-01 00:00:00+00') TO ('2027-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_09" ADD CONSTRAINT "usage_job_executions_2027_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-09-01 00:00:00+00') TO ('2027-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_09" ADD CONSTRAINT "usage_inference_segments_2027_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-10-01 00:00:00+00') TO ('2027-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_10" ADD CONSTRAINT "usage_job_executions_2027_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-10-01 00:00:00+00') TO ('2027-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_10" ADD CONSTRAINT "usage_inference_segments_2027_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-11-01 00:00:00+00') TO ('2027-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_11" ADD CONSTRAINT "usage_job_executions_2027_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-11-01 00:00:00+00') TO ('2027-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_11" ADD CONSTRAINT "usage_inference_segments_2027_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2027_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2027-12-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2027_12" ADD CONSTRAINT "usage_job_executions_2027_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2027_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2027-12-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2027_12" ADD CONSTRAINT "usage_inference_segments_2027_12_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-01-01 00:00:00+00') TO ('2028-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_01" ADD CONSTRAINT "usage_job_executions_2028_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-01-01 00:00:00+00') TO ('2028-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_01" ADD CONSTRAINT "usage_inference_segments_2028_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-02-01 00:00:00+00') TO ('2028-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_02" ADD CONSTRAINT "usage_job_executions_2028_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-02-01 00:00:00+00') TO ('2028-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_02" ADD CONSTRAINT "usage_inference_segments_2028_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-03-01 00:00:00+00') TO ('2028-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_03" ADD CONSTRAINT "usage_job_executions_2028_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-03-01 00:00:00+00') TO ('2028-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_03" ADD CONSTRAINT "usage_inference_segments_2028_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-04-01 00:00:00+00') TO ('2028-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_04" ADD CONSTRAINT "usage_job_executions_2028_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-04-01 00:00:00+00') TO ('2028-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_04" ADD CONSTRAINT "usage_inference_segments_2028_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-05-01 00:00:00+00') TO ('2028-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_05" ADD CONSTRAINT "usage_job_executions_2028_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-05-01 00:00:00+00') TO ('2028-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_05" ADD CONSTRAINT "usage_inference_segments_2028_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-06-01 00:00:00+00') TO ('2028-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_06" ADD CONSTRAINT "usage_job_executions_2028_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-06-01 00:00:00+00') TO ('2028-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_06" ADD CONSTRAINT "usage_inference_segments_2028_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-07-01 00:00:00+00') TO ('2028-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_07" ADD CONSTRAINT "usage_job_executions_2028_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-07-01 00:00:00+00') TO ('2028-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_07" ADD CONSTRAINT "usage_inference_segments_2028_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-08-01 00:00:00+00') TO ('2028-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_08" ADD CONSTRAINT "usage_job_executions_2028_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-08-01 00:00:00+00') TO ('2028-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_08" ADD CONSTRAINT "usage_inference_segments_2028_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-09-01 00:00:00+00') TO ('2028-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_09" ADD CONSTRAINT "usage_job_executions_2028_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-09-01 00:00:00+00') TO ('2028-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_09" ADD CONSTRAINT "usage_inference_segments_2028_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-10-01 00:00:00+00') TO ('2028-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_10" ADD CONSTRAINT "usage_job_executions_2028_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-10-01 00:00:00+00') TO ('2028-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_10" ADD CONSTRAINT "usage_inference_segments_2028_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-11-01 00:00:00+00') TO ('2028-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_11" ADD CONSTRAINT "usage_job_executions_2028_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-11-01 00:00:00+00') TO ('2028-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_11" ADD CONSTRAINT "usage_inference_segments_2028_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2028_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2028-12-01 00:00:00+00') TO ('2029-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2028_12" ADD CONSTRAINT "usage_job_executions_2028_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2028_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2028-12-01 00:00:00+00') TO ('2029-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2028_12" ADD CONSTRAINT "usage_inference_segments_2028_12_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-01-01 00:00:00+00') TO ('2029-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_01" ADD CONSTRAINT "usage_job_executions_2029_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-01-01 00:00:00+00') TO ('2029-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_01" ADD CONSTRAINT "usage_inference_segments_2029_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-02-01 00:00:00+00') TO ('2029-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_02" ADD CONSTRAINT "usage_job_executions_2029_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-02-01 00:00:00+00') TO ('2029-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_02" ADD CONSTRAINT "usage_inference_segments_2029_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-03-01 00:00:00+00') TO ('2029-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_03" ADD CONSTRAINT "usage_job_executions_2029_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-03-01 00:00:00+00') TO ('2029-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_03" ADD CONSTRAINT "usage_inference_segments_2029_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-04-01 00:00:00+00') TO ('2029-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_04" ADD CONSTRAINT "usage_job_executions_2029_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-04-01 00:00:00+00') TO ('2029-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_04" ADD CONSTRAINT "usage_inference_segments_2029_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-05-01 00:00:00+00') TO ('2029-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_05" ADD CONSTRAINT "usage_job_executions_2029_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-05-01 00:00:00+00') TO ('2029-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_05" ADD CONSTRAINT "usage_inference_segments_2029_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-06-01 00:00:00+00') TO ('2029-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_06" ADD CONSTRAINT "usage_job_executions_2029_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-06-01 00:00:00+00') TO ('2029-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_06" ADD CONSTRAINT "usage_inference_segments_2029_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-07-01 00:00:00+00') TO ('2029-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_07" ADD CONSTRAINT "usage_job_executions_2029_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-07-01 00:00:00+00') TO ('2029-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_07" ADD CONSTRAINT "usage_inference_segments_2029_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-08-01 00:00:00+00') TO ('2029-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_08" ADD CONSTRAINT "usage_job_executions_2029_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-08-01 00:00:00+00') TO ('2029-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_08" ADD CONSTRAINT "usage_inference_segments_2029_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-09-01 00:00:00+00') TO ('2029-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_09" ADD CONSTRAINT "usage_job_executions_2029_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-09-01 00:00:00+00') TO ('2029-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_09" ADD CONSTRAINT "usage_inference_segments_2029_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-10-01 00:00:00+00') TO ('2029-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_10" ADD CONSTRAINT "usage_job_executions_2029_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-10-01 00:00:00+00') TO ('2029-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_10" ADD CONSTRAINT "usage_inference_segments_2029_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-11-01 00:00:00+00') TO ('2029-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_11" ADD CONSTRAINT "usage_job_executions_2029_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-11-01 00:00:00+00') TO ('2029-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_11" ADD CONSTRAINT "usage_inference_segments_2029_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2029_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2029-12-01 00:00:00+00') TO ('2030-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2029_12" ADD CONSTRAINT "usage_job_executions_2029_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2029_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2029-12-01 00:00:00+00') TO ('2030-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2029_12" ADD CONSTRAINT "usage_inference_segments_2029_12_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-01-01 00:00:00+00') TO ('2030-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_01" ADD CONSTRAINT "usage_job_executions_2030_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-01-01 00:00:00+00') TO ('2030-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_01" ADD CONSTRAINT "usage_inference_segments_2030_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-02-01 00:00:00+00') TO ('2030-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_02" ADD CONSTRAINT "usage_job_executions_2030_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-02-01 00:00:00+00') TO ('2030-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_02" ADD CONSTRAINT "usage_inference_segments_2030_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-03-01 00:00:00+00') TO ('2030-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_03" ADD CONSTRAINT "usage_job_executions_2030_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-03-01 00:00:00+00') TO ('2030-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_03" ADD CONSTRAINT "usage_inference_segments_2030_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-04-01 00:00:00+00') TO ('2030-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_04" ADD CONSTRAINT "usage_job_executions_2030_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-04-01 00:00:00+00') TO ('2030-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_04" ADD CONSTRAINT "usage_inference_segments_2030_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-05-01 00:00:00+00') TO ('2030-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_05" ADD CONSTRAINT "usage_job_executions_2030_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-05-01 00:00:00+00') TO ('2030-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_05" ADD CONSTRAINT "usage_inference_segments_2030_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-06-01 00:00:00+00') TO ('2030-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_06" ADD CONSTRAINT "usage_job_executions_2030_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-06-01 00:00:00+00') TO ('2030-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_06" ADD CONSTRAINT "usage_inference_segments_2030_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-07-01 00:00:00+00') TO ('2030-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_07" ADD CONSTRAINT "usage_job_executions_2030_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-07-01 00:00:00+00') TO ('2030-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_07" ADD CONSTRAINT "usage_inference_segments_2030_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-08-01 00:00:00+00') TO ('2030-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_08" ADD CONSTRAINT "usage_job_executions_2030_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-08-01 00:00:00+00') TO ('2030-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_08" ADD CONSTRAINT "usage_inference_segments_2030_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-09-01 00:00:00+00') TO ('2030-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_09" ADD CONSTRAINT "usage_job_executions_2030_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-09-01 00:00:00+00') TO ('2030-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_09" ADD CONSTRAINT "usage_inference_segments_2030_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-10-01 00:00:00+00') TO ('2030-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_10" ADD CONSTRAINT "usage_job_executions_2030_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-10-01 00:00:00+00') TO ('2030-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_10" ADD CONSTRAINT "usage_inference_segments_2030_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-11-01 00:00:00+00') TO ('2030-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_11" ADD CONSTRAINT "usage_job_executions_2030_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-11-01 00:00:00+00') TO ('2030-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_11" ADD CONSTRAINT "usage_inference_segments_2030_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2030_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2030-12-01 00:00:00+00') TO ('2031-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2030_12" ADD CONSTRAINT "usage_job_executions_2030_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2030_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2030-12-01 00:00:00+00') TO ('2031-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2030_12" ADD CONSTRAINT "usage_inference_segments_2030_12_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_01" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-01-01 00:00:00+00') TO ('2031-02-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_01" ADD CONSTRAINT "usage_job_executions_2031_01_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_01" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-01-01 00:00:00+00') TO ('2031-02-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_01" ADD CONSTRAINT "usage_inference_segments_2031_01_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_02" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-02-01 00:00:00+00') TO ('2031-03-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_02" ADD CONSTRAINT "usage_job_executions_2031_02_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_02" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-02-01 00:00:00+00') TO ('2031-03-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_02" ADD CONSTRAINT "usage_inference_segments_2031_02_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_03" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-03-01 00:00:00+00') TO ('2031-04-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_03" ADD CONSTRAINT "usage_job_executions_2031_03_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_03" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-03-01 00:00:00+00') TO ('2031-04-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_03" ADD CONSTRAINT "usage_inference_segments_2031_03_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_04" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-04-01 00:00:00+00') TO ('2031-05-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_04" ADD CONSTRAINT "usage_job_executions_2031_04_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_04" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-04-01 00:00:00+00') TO ('2031-05-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_04" ADD CONSTRAINT "usage_inference_segments_2031_04_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_05" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-05-01 00:00:00+00') TO ('2031-06-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_05" ADD CONSTRAINT "usage_job_executions_2031_05_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_05" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-05-01 00:00:00+00') TO ('2031-06-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_05" ADD CONSTRAINT "usage_inference_segments_2031_05_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_06" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-06-01 00:00:00+00') TO ('2031-07-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_06" ADD CONSTRAINT "usage_job_executions_2031_06_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_06" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-06-01 00:00:00+00') TO ('2031-07-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_06" ADD CONSTRAINT "usage_inference_segments_2031_06_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_07" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-07-01 00:00:00+00') TO ('2031-08-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_07" ADD CONSTRAINT "usage_job_executions_2031_07_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_07" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-07-01 00:00:00+00') TO ('2031-08-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_07" ADD CONSTRAINT "usage_inference_segments_2031_07_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_08" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-08-01 00:00:00+00') TO ('2031-09-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_08" ADD CONSTRAINT "usage_job_executions_2031_08_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_08" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-08-01 00:00:00+00') TO ('2031-09-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_08" ADD CONSTRAINT "usage_inference_segments_2031_08_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_09" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-09-01 00:00:00+00') TO ('2031-10-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_09" ADD CONSTRAINT "usage_job_executions_2031_09_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_09" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-09-01 00:00:00+00') TO ('2031-10-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_09" ADD CONSTRAINT "usage_inference_segments_2031_09_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_10" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-10-01 00:00:00+00') TO ('2031-11-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_10" ADD CONSTRAINT "usage_job_executions_2031_10_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_10" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-10-01 00:00:00+00') TO ('2031-11-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_10" ADD CONSTRAINT "usage_inference_segments_2031_10_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_11" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-11-01 00:00:00+00') TO ('2031-12-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_11" ADD CONSTRAINT "usage_job_executions_2031_11_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_11" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-11-01 00:00:00+00') TO ('2031-12-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_11" ADD CONSTRAINT "usage_inference_segments_2031_11_pkey" PRIMARY KEY ("id", "recorded_at");
CREATE TABLE "usage_job_executions_2031_12" PARTITION OF "usage_job_executions" FOR VALUES FROM ('2031-12-01 00:00:00+00') TO ('2032-01-01 00:00:00+00');
ALTER TABLE "usage_job_executions_2031_12" ADD CONSTRAINT "usage_job_executions_2031_12_pkey" PRIMARY KEY ("job_execution_id", "recorded_at");
CREATE TABLE "usage_inference_segments_2031_12" PARTITION OF "usage_inference_segments" FOR VALUES FROM ('2031-12-01 00:00:00+00') TO ('2032-01-01 00:00:00+00');
ALTER TABLE "usage_inference_segments_2031_12" ADD CONSTRAINT "usage_inference_segments_2031_12_pkey" PRIMARY KEY ("id", "recorded_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "usage_ensure_monthly_partitions"(reference_time timestamptz)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  table_name text;
  default_table_name text;
  key_columns text;
  minimum_recorded_at timestamptz;
  maximum_recorded_at timestamptz;
  current_month date := date_trunc('month', reference_time AT TIME ZONE 'UTC')::date;
  month_start date;
  partition_end date;
  range_end date;
  suffix text;
  child_name text;
  stage_name text;
  lower_bound text;
  upper_bound text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('shipfox.usage.monthly-partitions'));

  FOR table_name, default_table_name, key_columns IN
    VALUES
      ('usage_job_executions', 'usage_job_executions_unrecorded', '"job_execution_id", "recorded_at"'),
      ('usage_inference_segments', 'usage_inference_segments_default', '"id", "recorded_at"')
  LOOP
    EXECUTE format('SELECT min(recorded_at), max(recorded_at) FROM %I', default_table_name)
      INTO minimum_recorded_at, maximum_recorded_at;

    month_start := least(
      current_month,
      coalesce(date_trunc('month', minimum_recorded_at AT TIME ZONE 'UTC')::date, current_month)
    );
    range_end := greatest(
      current_month,
      coalesce(date_trunc('month', maximum_recorded_at AT TIME ZONE 'UTC')::date, current_month)
    );

    WHILE month_start <= range_end LOOP
      partition_end := (month_start + interval '1 month')::date;
      suffix := to_char(month_start, 'YYYY_MM');
      child_name := table_name || '_' || suffix;
      stage_name := 'usage_partition_stage_' || replace(table_name, 'usage_', '') || '_' || suffix;
      lower_bound := to_char(month_start, 'YYYY-MM-DD') || ' 00:00:00+00';
      upper_bound := to_char(partition_end, 'YYYY-MM-DD') || ' 00:00:00+00';

      EXECUTE format(
        'CREATE TEMP TABLE %I ON COMMIT DROP AS SELECT * FROM %I WHERE false',
        stage_name,
        default_table_name
      );
      EXECUTE format(
        'INSERT INTO %I SELECT * FROM %I WHERE recorded_at >= %L::timestamptz AND recorded_at < %L::timestamptz',
        stage_name,
        default_table_name,
        lower_bound,
        upper_bound
      );
      EXECUTE format(
        'DELETE FROM %I WHERE recorded_at >= %L::timestamptz AND recorded_at < %L::timestamptz',
        default_table_name,
        lower_bound,
        upper_bound
      );

      IF to_regclass(child_name) IS NULL THEN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
          child_name,
          table_name,
          lower_bound,
          upper_bound
        );
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY (%s)',
          child_name,
          child_name || '_pkey',
          key_columns
        );
      END IF;

      EXECUTE format('INSERT INTO %I SELECT * FROM %I ON CONFLICT DO NOTHING', child_name, stage_name);
      EXECUTE format('DROP TABLE %I', stage_name);
      month_start := partition_end;
    END LOOP;
  END LOOP;
END;
$function$;
--> statement-breakpoint
CREATE TABLE "usage_job_executions_unrecorded" PARTITION OF "usage_job_executions" DEFAULT;
ALTER TABLE "usage_job_executions_unrecorded" ADD CONSTRAINT "usage_job_executions_unrecorded_pkey" PRIMARY KEY ("job_execution_id");
--> statement-breakpoint
CREATE TABLE "usage_inference_segments_default" PARTITION OF "usage_inference_segments" DEFAULT;
ALTER TABLE "usage_inference_segments_default" ADD CONSTRAINT "usage_inference_segments_default_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
CREATE INDEX "usage_job_executions_workspace_recorded_idx" ON "usage_job_executions" USING btree ("workspace_id", "recorded_at");
CREATE INDEX "usage_job_executions_recorded_job_execution_idx" ON "usage_job_executions" USING btree ("recorded_at", "job_execution_id");
CREATE INDEX "usage_job_executions_workflow_run_idx" ON "usage_job_executions" USING btree ("workflow_run_id");
CREATE INDEX "usage_job_executions_job_execution_idx" ON "usage_job_executions" USING btree ("job_execution_id");
CREATE UNIQUE INDEX "usage_inference_segments_segment_key_recorded_unique" ON "usage_inference_segments" USING btree ("segment_key", "recorded_at");
CREATE INDEX "usage_inference_segments_workspace_recorded_idx" ON "usage_inference_segments" USING btree ("workspace_id", "recorded_at");
CREATE INDEX "usage_inference_segments_recorded_id_idx" ON "usage_inference_segments" USING btree ("recorded_at", "id");
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
