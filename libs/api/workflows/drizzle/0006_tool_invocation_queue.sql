CREATE TYPE "public"."workflows_tool_invocation_status" AS ENUM('queued', 'in_flight', 'settled');--> statement-breakpoint
CREATE TABLE "workflows_tool_invocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"step_id" uuid NOT NULL,
	"step_attempt_id" uuid NOT NULL,
	"job_execution_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"status" "workflows_tool_invocation_status" DEFAULT 'queued' NOT NULL,
	"call_index" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"claimed_by" text,
	"claim_expires_at" timestamp with time zone,
	"last_error_code" text,
	CONSTRAINT "workflows_tool_invocations_step_attempt_id_uq" UNIQUE("step_attempt_id"),
	CONSTRAINT "workflows_tool_invocations_call_index_nonnegative_ck" CHECK ("workflows_tool_invocations"."call_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD COLUMN "invocations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_tool_invocations" ADD CONSTRAINT "workflows_tool_invocations_step_id_workflows_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."workflows_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_tool_invocations" ADD CONSTRAINT "workflows_tool_invocations_step_attempt_id_workflows_step_attempts_id_fk" FOREIGN KEY ("step_attempt_id") REFERENCES "public"."workflows_step_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_tool_invocations" ADD CONSTRAINT "workflows_tool_invocations_job_execution_id_workflows_job_executions_id_fk" FOREIGN KEY ("job_execution_id") REFERENCES "public"."workflows_job_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_tool_invocations" ADD CONSTRAINT "workflows_tool_invocations_step_id_job_execution_id_workflows_steps_fk" FOREIGN KEY ("step_id","job_execution_id") REFERENCES "public"."workflows_steps"("id","job_execution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD CONSTRAINT "workflows_step_attempts_id_step_id_job_execution_id_uq" UNIQUE("id","step_id","job_execution_id");--> statement-breakpoint
ALTER TABLE "workflows_tool_invocations" ADD CONSTRAINT "workflows_tool_invocations_step_attempt_id_step_id_job_execution_id_workflows_step_attempts_fk" FOREIGN KEY ("step_attempt_id","step_id","job_execution_id") REFERENCES "public"."workflows_step_attempts"("id","step_id","job_execution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_tool_invocations_job_execution_id_idx" ON "workflows_tool_invocations" USING btree ("job_execution_id");--> statement-breakpoint
CREATE INDEX "workflows_tool_invocations_due_at_unsettled_idx" ON "workflows_tool_invocations" USING btree ("due_at") WHERE "workflows_tool_invocations"."status" <> 'settled';--> statement-breakpoint
