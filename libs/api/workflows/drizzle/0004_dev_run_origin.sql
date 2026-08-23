ALTER TABLE "workflows_workflow_runs" ADD COLUMN "origin" text DEFAULT 'synced' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN "dev_source" jsonb;--> statement-breakpoint
CREATE INDEX "workflows_wr_project_origin_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","origin","created_at","id");