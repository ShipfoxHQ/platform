ALTER TABLE "workflows_workflow_runs" DROP CONSTRAINT "workflows_wr_dev_source_ck";--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD CONSTRAINT "workflows_wr_dev_source_ck" CHECK ((
        ("workflows_workflow_runs"."origin" = 'synced' and "workflows_workflow_runs"."dev_source" is null)
        or (
          "workflows_workflow_runs"."origin" = 'dev'
          and "workflows_workflow_runs"."dev_source" is not null
          and jsonb_typeof("workflows_workflow_runs"."dev_source") = 'object'
        )
      ));