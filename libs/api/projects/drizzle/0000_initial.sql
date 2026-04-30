CREATE TABLE "projects_projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"source_external_repository_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_source_unique" ON "projects_projects" USING btree ("source_connection_id","source_external_repository_id");--> statement-breakpoint
CREATE INDEX "projects_workspace_created_id_idx" ON "projects_projects" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "projects_outbox_pending_idx" ON "projects_outbox" USING btree ("created_at") WHERE "dispatched_at" IS NULL;
