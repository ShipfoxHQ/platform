CREATE TYPE "public"."projects_vcs_provider" AS ENUM('test', 'github', 'gitlab');--> statement-breakpoint
CREATE TYPE "public"."projects_repository_visibility" AS ENUM('public', 'private', 'internal', 'unknown');--> statement-breakpoint
CREATE TABLE "projects_vcs_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "projects_vcs_provider" NOT NULL,
	"provider_host" text NOT NULL,
	"external_connection_id" text NOT NULL,
	"display_name" text NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects_repositories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"vcs_connection_id" uuid NOT NULL,
	"provider" "projects_vcs_provider" NOT NULL,
	"provider_host" text NOT NULL,
	"external_repository_id" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"visibility" "projects_repository_visibility" DEFAULT 'unknown' NOT NULL,
	"clone_url" text NOT NULL,
	"html_url" text NOT NULL,
	"metadata_fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects_projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
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
ALTER TABLE "projects_repositories" ADD CONSTRAINT "projects_repositories_vcs_connection_id_projects_vcs_connections_id_fk" FOREIGN KEY ("vcs_connection_id") REFERENCES "public"."projects_vcs_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects_projects" ADD CONSTRAINT "projects_projects_repository_id_projects_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."projects_repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_vcs_connections_workspace_external_unique" ON "projects_vcs_connections" USING btree ("workspace_id","provider","provider_host","external_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_repositories_connection_external_unique" ON "projects_repositories" USING btree ("vcs_connection_id","external_repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_repository_unique" ON "projects_projects" USING btree ("workspace_id","repository_id");--> statement-breakpoint
CREATE INDEX "projects_workspace_created_id_idx" ON "projects_projects" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "projects_outbox_pending_idx" ON "projects_outbox" USING btree ("created_at") WHERE "dispatched_at" IS NULL;
