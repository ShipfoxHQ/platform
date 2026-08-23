ALTER TABLE "workflows_workflow_runs" ADD COLUMN "origin" text DEFAULT 'synced' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN "dev_source" jsonb;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD CONSTRAINT "workflows_wr_origin_ck" CHECK ("origin" in ('synced', 'dev'));--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD CONSTRAINT "workflows_wr_dev_source_ck" CHECK ((
  ("origin" = 'synced' and "dev_source" is null)
  or (
    "origin" = 'dev'
    and "dev_source" is not null
    and jsonb_typeof("dev_source") = 'object'
  )
));--> statement-breakpoint
CREATE INDEX "workflows_wr_project_origin_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","origin","created_at","id");
