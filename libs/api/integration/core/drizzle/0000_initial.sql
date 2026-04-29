CREATE TABLE "integrations_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"lifecycle_status" text DEFAULT 'active' NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_connections_workspace_external_unique" ON "integrations_connections" USING btree ("workspace_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "integrations_connections_workspace_id_idx" ON "integrations_connections" USING btree ("workspace_id");
