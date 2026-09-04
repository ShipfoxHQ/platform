ALTER TABLE "workflows_job_executions" ADD COLUMN "runner_labels" jsonb;--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD COLUMN "provisioner_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD COLUMN "provisioner_scope" text;--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD COLUMN "provider_kind" text;--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD COLUMN "launch_kind" text;