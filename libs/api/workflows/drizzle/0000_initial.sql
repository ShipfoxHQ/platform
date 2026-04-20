CREATE TYPE "public"."workflows_job_status" AS ENUM('pending', 'waiting_for_dependencies', 'ready', 'running', 'succeeded', 'failed', 'cancelled', 'awaiting_manual');--> statement-breakpoint
CREATE TYPE "public"."workflows_step_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflows_run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "workflows_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "workflows_job_status" DEFAULT 'pending' NOT NULL,
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
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflows_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"name" text,
	"status" "workflows_step_status" DEFAULT 'pending' NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"output" jsonb,
	"error" jsonb,
	"position" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows_workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"status" "workflows_run_status" DEFAULT 'pending' NOT NULL,
	"trigger_context" jsonb NOT NULL,
	"inputs" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflows_jobs" ADD CONSTRAINT "workflows_jobs_run_id_workflows_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflows_workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD CONSTRAINT "workflows_steps_job_id_workflows_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."workflows_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_jobs_run_id_idx" ON "workflows_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "workflows_outbox_pending_idx" ON "workflows_outbox" USING btree ("created_at") WHERE "dispatched_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workflows_steps_job_id_idx" ON "workflows_steps" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "workflows_wr_project_status_idx" ON "workflows_workflow_runs" USING btree ("project_id","status");