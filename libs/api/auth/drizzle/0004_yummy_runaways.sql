CREATE TYPE "public"."auth_agent_client_kind" AS ENUM('registered', 'cimd');--> statement-breakpoint
CREATE TABLE "auth_agent_authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"grant_id" uuid NOT NULL,
	"hashed_code" text NOT NULL,
	"code_challenge" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_agent_authorization_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"client_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"resource" text NOT NULL,
	"scopes" text[] NOT NULL,
	"code_challenge" text NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_agent_clients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"kind" "auth_agent_client_kind" NOT NULL,
	"last_seen_at" timestamp with time zone,
	"unreferenced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_agent_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_agent_pats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"hashed_token" text NOT NULL,
	"prefix" text NOT NULL,
	"name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_agent_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"grant_id" uuid NOT NULL,
	"hashed_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_agent_authorization_codes" ADD CONSTRAINT "auth_agent_authorization_codes_grant_id_auth_agent_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."auth_agent_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_agent_authorization_requests" ADD CONSTRAINT "auth_agent_authorization_requests_client_id_auth_agent_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."auth_agent_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_agent_grants" ADD CONSTRAINT "auth_agent_grants_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_agent_grants" ADD CONSTRAINT "auth_agent_grants_client_id_auth_agent_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."auth_agent_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_agent_pats" ADD CONSTRAINT "auth_agent_pats_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_agent_refresh_tokens" ADD CONSTRAINT "auth_agent_refresh_tokens_grant_id_auth_agent_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."auth_agent_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_agent_authorization_codes_hashed_code_unique" ON "auth_agent_authorization_codes" USING btree ("hashed_code");--> statement-breakpoint
CREATE INDEX "auth_agent_authorization_codes_grant_id_idx" ON "auth_agent_authorization_codes" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "auth_agent_authorization_codes_expires_at_idx" ON "auth_agent_authorization_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_agent_authorization_requests_client_id_idx" ON "auth_agent_authorization_requests" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_agent_authorization_requests_expires_at_idx" ON "auth_agent_authorization_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_agent_clients_client_id_unique" ON "auth_agent_clients" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_agent_clients_unreferenced_at_idx" ON "auth_agent_clients" USING btree ("unreferenced_at");--> statement-breakpoint
CREATE INDEX "auth_agent_clients_created_at_idx" ON "auth_agent_clients" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auth_agent_grants_user_id_idx" ON "auth_agent_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_agent_grants_workspace_id_idx" ON "auth_agent_grants" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "auth_agent_grants_client_id_idx" ON "auth_agent_grants" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_agent_grants_terminal_at_idx" ON "auth_agent_grants" USING btree ("terminal_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_agent_pats_hashed_token_unique" ON "auth_agent_pats" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "auth_agent_pats_user_id_idx" ON "auth_agent_pats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_agent_pats_workspace_id_idx" ON "auth_agent_pats" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "auth_agent_pats_expires_at_idx" ON "auth_agent_pats" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_agent_pats_revoked_at_idx" ON "auth_agent_pats" USING btree ("revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_agent_refresh_tokens_hashed_token_unique" ON "auth_agent_refresh_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_agent_refresh_tokens_live_grant_unique" ON "auth_agent_refresh_tokens" USING btree ("grant_id") WHERE "auth_agent_refresh_tokens"."rotated_at" IS NULL AND "auth_agent_refresh_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "auth_agent_refresh_tokens_grant_id_idx" ON "auth_agent_refresh_tokens" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "auth_agent_refresh_tokens_expires_at_idx" ON "auth_agent_refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_agent_refresh_tokens_rotated_at_idx" ON "auth_agent_refresh_tokens" USING btree ("rotated_at");--> statement-breakpoint
CREATE INDEX "auth_agent_refresh_tokens_revoked_at_idx" ON "auth_agent_refresh_tokens" USING btree ("revoked_at");
