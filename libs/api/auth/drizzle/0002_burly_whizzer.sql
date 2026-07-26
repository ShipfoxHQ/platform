CREATE TABLE "auth_admin_command_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_id" uuid NOT NULL,
	"idempotency_key_fingerprint" text NOT NULL,
	"command" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_admin_command_results" ADD CONSTRAINT "auth_admin_command_results_actor_id_auth_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_admin_command_results_actor_key_unique" ON "auth_admin_command_results" USING btree ("actor_id","idempotency_key_fingerprint");