CREATE TYPE "public"."workspaces_workspace_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TABLE "workspaces_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"hashed_key" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"status" "workspaces_workspace_status" DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces_api_keys" ADD CONSTRAINT "workspaces_api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_api_keys_hashed_key_unique" ON "workspaces_api_keys" USING btree ("hashed_key");--> statement-breakpoint
CREATE INDEX "workspaces_api_keys_workspace_id_idx" ON "workspaces_api_keys" USING btree ("workspace_id");