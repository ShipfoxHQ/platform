CREATE TYPE "public"."workflows_job_execution_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflows_job_listener_event_disposition" AS ENUM('fire', 'resolve');--> statement-breakpoint
CREATE TYPE "public"."workflows_job_mode" AS ENUM('one_shot', 'listening');--> statement-breakpoint
CREATE TYPE "public"."workflows_checkout_contents" AS ENUM('read', 'write');--> statement-breakpoint
CREATE TYPE "public"."workflows_job_on_resolve" AS ENUM('finish', 'cancel');--> statement-breakpoint
CREATE TYPE "public"."workflows_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."workflows_job_status_reason" AS ENUM('dependency_not_completed', 'condition_false', 'default_gate_rejected', 'condition_rejected', 'condition_errored', 'user_cancelled', 'run_cancelled', 'timed_out', 'runner_lost', 'step_failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."workflows_listener_status" AS ENUM('inactive', 'listening', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."workflows_resolution_reason" AS ENUM('until', 'timeout', 'max_executions', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflows_step_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."workflows_step_status_reason" AS ENUM('default_gate_rejected', 'condition_rejected', 'condition_errored');--> statement-breakpoint
CREATE TYPE "public"."workflows_rerun_mode" AS ENUM('all', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workflows_run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "workflows_job_executions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"name" text,
	"runner" jsonb,
	"status" "workflows_job_execution_status" DEFAULT 'pending' NOT NULL,
	"status_reason" "workflows_job_status_reason",
	"trigger_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb,
	"evaluation_trace" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"timed_out_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflows_job_listener_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"disposition" "workflows_job_listener_event_disposition" NOT NULL,
	"event_ref" text NOT NULL,
	"delivery_id" text NOT NULL,
	"source" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"consumed_by_execution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workflow_run_attempt_id" uuid NOT NULL,
	"key" text NOT NULL,
	"mode" "workflows_job_mode" DEFAULT 'one_shot' NOT NULL,
	"name" text,
	"status" "workflows_job_status" DEFAULT 'pending' NOT NULL,
	"status_reason" "workflows_job_status_reason",
	"carried_over" boolean DEFAULT false NOT NULL,
	"checkout_persist_credentials" boolean NOT NULL,
	"checkout_permissions_contents" "workflows_checkout_contents" NOT NULL,
	"success" text,
	"evaluation_trace" jsonb,
	"execution_timeout_ms" integer,
	"listening_timeout_ms" bigint,
	"max_executions" integer,
	"on_resolve" "workflows_job_on_resolve",
	"batch_debounce_ms" integer,
	"batch_max_size" integer,
	"batch_max_wait_ms" integer,
	"listener_status" "workflows_listener_status" DEFAULT 'inactive' NOT NULL,
	"resolution_reason" "workflows_resolution_reason",
	"listening_on" jsonb,
	"listening_until" jsonb,
	"outputs" jsonb,
	"dependencies" jsonb NOT NULL,
	"runner" jsonb,
	"position" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows_outbox" (
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
CREATE TABLE "workflows_step_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"step_id" uuid NOT NULL,
	"job_execution_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"execution_order" integer NOT NULL,
	"status" "workflows_step_status" NOT NULL,
	"config" jsonb,
	"evaluation_trace" jsonb,
	"output" jsonb,
	"response" text,
	"error" jsonb,
	"exit_code" integer,
	"log_outcome" text,
	"gate_result" jsonb,
	"restart_feedback" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_step_attempts_step_id_attempt_uq" UNIQUE("step_id","attempt"),
	CONSTRAINT "workflows_step_attempts_job_execution_id_execution_order_uq" UNIQUE("job_execution_id","execution_order"),
	CONSTRAINT "workflows_step_attempts_attempt_positive_ck" CHECK ("workflows_step_attempts"."attempt" > 0),
	CONSTRAINT "workflows_step_attempts_execution_order_positive_ck" CHECK ("workflows_step_attempts"."execution_order" > 0),
	CONSTRAINT "workflows_step_attempts_status_dispatched_ck" CHECK ("workflows_step_attempts"."status" NOT IN ('pending', 'skipped')),
	CONSTRAINT "workflows_step_attempts_log_outcome_ck" CHECK ("workflows_step_attempts"."log_outcome" IS NULL OR "workflows_step_attempts"."log_outcome" IN ('drained', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "workflows_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_execution_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"source_location" jsonb,
	"status" "workflows_step_status" DEFAULT 'pending' NOT NULL,
	"status_reason" "workflows_step_status_reason",
	"evaluation_trace" jsonb,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"condition" jsonb,
	"config_plan" jsonb,
	"authored_config" jsonb,
	"error" jsonb,
	"position" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"current_attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_steps_current_attempt_positive_ck" CHECK ("workflows_steps"."current_attempt" > 0)
);
--> statement-breakpoint
CREATE TABLE "workflows_workflow_run_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" "workflows_run_status" DEFAULT 'pending' NOT NULL,
	"rerun_mode" "workflows_rerun_mode",
	"rerun_by_user_id" uuid,
	"model" jsonb,
	"vars" jsonb,
	"agent_tool_materialization" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "workflows_wra_attempt_positive_ck" CHECK ("workflows_workflow_run_attempts"."attempt" > 0)
);
--> statement-breakpoint
CREATE TABLE "workflows_workflow_run_counters" (
	"definition_id" uuid NOT NULL,
	"next_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows_workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text,
	"workflow_name" text NOT NULL,
	"status" "workflows_run_status" DEFAULT 'pending' NOT NULL,
	"current_attempt" integer DEFAULT 1 NOT NULL,
	"trigger_provider" text,
	"trigger_source" text NOT NULL,
	"trigger_event" text NOT NULL,
	"trigger_payload" jsonb NOT NULL,
	"trigger_reference" jsonb,
	"inputs" jsonb,
	"source_snapshot" jsonb,
	"trigger_idempotency_key" text,
	"timeout_ms" bigint DEFAULT 2592000000 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "workflows_wr_current_attempt_positive_ck" CHECK ("workflows_workflow_runs"."current_attempt" > 0)
);
--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD CONSTRAINT "workflows_job_executions_job_id_workflows_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."workflows_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD CONSTRAINT "workflows_job_listener_events_job_id_workflows_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."workflows_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_job_listener_events" ADD CONSTRAINT "workflows_job_listener_events_consumed_by_execution_id_workflows_job_executions_id_fk" FOREIGN KEY ("consumed_by_execution_id") REFERENCES "public"."workflows_job_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_jobs" ADD CONSTRAINT "workflows_jobs_workflow_run_attempt_id_workflows_workflow_run_attempts_id_fk" FOREIGN KEY ("workflow_run_attempt_id") REFERENCES "public"."workflows_workflow_run_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD CONSTRAINT "workflows_step_attempts_step_id_workflows_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."workflows_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_steps_id_job_execution_id_uq" ON "workflows_steps" USING btree ("id","job_execution_id");--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD CONSTRAINT "workflows_step_attempts_step_id_job_execution_id_workflows_steps_fk" FOREIGN KEY ("step_id","job_execution_id") REFERENCES "public"."workflows_steps"("id","job_execution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD CONSTRAINT "workflows_steps_job_execution_id_workflows_job_executions_id_fk" FOREIGN KEY ("job_execution_id") REFERENCES "public"."workflows_job_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_workflow_run_attempts" ADD CONSTRAINT "workflows_workflow_run_attempts_workflow_run_id_workflows_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflows_workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_job_executions_job_id_idx" ON "workflows_job_executions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "workflows_job_executions_running_idx" ON "workflows_job_executions" USING btree ("status") WHERE "workflows_job_executions"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_job_executions_job_sequence_uq" ON "workflows_job_executions" USING btree ("job_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_job_listener_events_job_event_ref_unique" ON "workflows_job_listener_events" USING btree ("job_id","event_ref");--> statement-breakpoint
CREATE INDEX "workflows_job_listener_events_job_received_idx" ON "workflows_job_listener_events" USING btree ("job_id","received_at");--> statement-breakpoint
CREATE INDEX "workflows_jobs_workflow_run_attempt_id_idx" ON "workflows_jobs" USING btree ("workflow_run_attempt_id");--> statement-breakpoint
CREATE INDEX "workflows_jobs_active_listeners_idx" ON "workflows_jobs" USING btree ("listener_status") WHERE "workflows_jobs"."listener_status" = 'listening';--> statement-breakpoint
CREATE INDEX "workflows_outbox_pending_idx" ON "workflows_outbox" USING btree ("next_dispatch_at","created_at") WHERE "dispatched_at" IS NULL AND "dead_lettered_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workflows_outbox_dispatched_retention_idx" ON "workflows_outbox" USING btree ("dispatched_at","id") WHERE "dispatched_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workflows_steps_job_execution_id_idx" ON "workflows_steps" USING btree ("job_execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wra_workflow_run_attempt_unique" ON "workflows_workflow_run_attempts" USING btree ("workflow_run_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wra_one_active_attempt_unique" ON "workflows_workflow_run_attempts" USING btree ("workflow_run_id") WHERE "workflows_workflow_run_attempts"."status" in ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wrrc_definition_id_unique" ON "workflows_workflow_run_counters" USING btree ("definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wr_trigger_idempotency_key_unique" ON "workflows_workflow_runs" USING btree ("trigger_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wr_definition_number_unique" ON "workflows_workflow_runs" USING btree ("definition_id","number");--> statement-breakpoint
CREATE INDEX "workflows_wr_project_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "workflows_wr_project_status_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "workflows_wr_project_definition_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","definition_id","created_at","id");--> statement-breakpoint
CREATE INDEX "workflows_wr_project_trigger_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","trigger_source","created_at","id");--> statement-breakpoint
CREATE INDEX "workflows_wr_running_idx" ON "workflows_workflow_runs" USING btree ("status") WHERE "workflows_workflow_runs"."status" = 'running';
