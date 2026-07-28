CREATE TABLE "runners_admin_command_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_id" uuid NOT NULL,
	"idempotency_key_fingerprint" text NOT NULL,
	"command" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "runners_admin_command_results_actor_key_unique" ON "runners_admin_command_results" USING btree ("actor_id","idempotency_key_fingerprint");