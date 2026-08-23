ALTER TABLE "workflows_workflow_runs" ADD COLUMN "origin" text DEFAULT 'synced' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN "dev_source" jsonb;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD CONSTRAINT "workflows_wr_origin_ck" CHECK ("origin" in ('synced', 'dev'));--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD CONSTRAINT "workflows_wr_dev_source_ck" CHECK ((
  ("origin" = 'synced' and "dev_source" is null)
  or (
    "origin" = 'dev'
    and "dev_source" is not null
    and jsonb_typeof("dev_source") = 'object'
    and "dev_source" ?& array['ref', 'commit', 'config_path', 'initiated_by_user_id', 'replay_of_event_id']
    and jsonb_typeof("dev_source"->'ref') = 'string'
    and jsonb_typeof("dev_source"->'commit') = 'string'
    and jsonb_typeof("dev_source"->'config_path') = 'string'
    and jsonb_typeof("dev_source"->'initiated_by_user_id') = 'string'
    and "dev_source"->>'initiated_by_user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (
      jsonb_typeof("dev_source"->'replay_of_event_id') = 'null'
      or (
        jsonb_typeof("dev_source"->'replay_of_event_id') = 'string'
        and "dev_source"->>'replay_of_event_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    )
  )
));--> statement-breakpoint
CREATE INDEX "workflows_wr_project_origin_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","origin","created_at","id");
