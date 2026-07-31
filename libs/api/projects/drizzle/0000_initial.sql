CREATE TABLE "projects_projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"source_external_repository_id" text NOT NULL,
	"source_repository_owner" text,
	"source_repository_name" text,
	"source_default_branch" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects_outbox" (
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
CREATE TABLE "projects_integration_event_dedup" (
	"integration_event_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_integration_event_dedup_integration_event_id_project_id_pk" PRIMARY KEY ("integration_event_id","project_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_source_unique" ON "projects_projects" USING btree ("source_connection_id","source_external_repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_slug_unique" ON "projects_projects" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "projects_workspace_created_id_idx" ON "projects_projects" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "projects_source_repository_lookup_idx" ON "projects_projects" USING btree ("workspace_id","source_connection_id",lower("source_repository_owner"),lower("source_repository_name"));--> statement-breakpoint
CREATE INDEX "projects_outbox_pending_idx" ON "projects_outbox" USING btree ("next_dispatch_at","created_at") WHERE "dispatched_at" IS NULL AND "dead_lettered_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "projects_outbox_dispatched_retention_idx" ON "projects_outbox" USING btree ("dispatched_at","id") WHERE "dispatched_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "projects_integration_event_dedup_received_at_idx" ON "projects_integration_event_dedup" USING btree ("received_at");
