CREATE TABLE "integrations_connection_repository_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"external_repository_id" text NOT NULL,
	"repository_owner" text NOT NULL,
	"repository_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integrations_connections" ADD COLUMN "repository_access" text DEFAULT 'selected' NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations_connection_repository_grants" ADD CONSTRAINT "integrations_connection_repository_grants_connection_id_integrations_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integrations_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_connection_repository_grants_connection_external_unique" ON "integrations_connection_repository_grants" USING btree ("connection_id","external_repository_id");--> statement-breakpoint
CREATE INDEX "integrations_connection_repository_grants_connection_owner_name_idx" ON "integrations_connection_repository_grants" USING btree ("connection_id",lower("repository_owner"),lower("repository_name"));