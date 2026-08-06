CREATE TABLE "integrations_secret_cleanups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_account_id" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"lifecycle_status" text NOT NULL,
	"connection_created_at" timestamp with time zone NOT NULL,
	"connection_updated_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_secret_cleanups_provider_connection_unique" ON "integrations_secret_cleanups" USING btree ("provider","connection_id");--> statement-breakpoint
CREATE INDEX "integrations_secret_cleanups_pending_idx" ON "integrations_secret_cleanups" USING btree ("next_attempt_at","created_at","id");
