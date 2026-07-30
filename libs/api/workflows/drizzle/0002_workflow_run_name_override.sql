ALTER TABLE "workflows_workflow_runs" RENAME COLUMN "name" TO "workflow_name";
--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN "name" text;
