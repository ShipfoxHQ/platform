ALTER TABLE "workflows_workflow_run_attempts" ADD COLUMN "agent_tool_materialization" jsonb;
--> statement-breakpoint
ALTER TABLE "workflows_workflow_run_attempts" ADD COLUMN "vars" jsonb;
