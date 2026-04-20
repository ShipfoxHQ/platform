CREATE TYPE "public"."auth_user_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"hashed_password" text NOT NULL,
	"name" text,
	"email_verified_at" timestamp with time zone,
	"status" "auth_user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"hashed_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_password_resets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"hashed_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"hashed_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_email_verifications" ADD CONSTRAINT "auth_email_verifications_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_password_resets" ADD CONSTRAINT "auth_password_resets_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_refresh_tokens" ADD CONSTRAINT "auth_refresh_tokens_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_email_unique" ON "auth_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_email_verifications_hashed_token_unique" ON "auth_email_verifications" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "auth_email_verifications_user_id_idx" ON "auth_email_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_password_resets_hashed_token_unique" ON "auth_password_resets" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "auth_password_resets_user_id_idx" ON "auth_password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_refresh_tokens_hashed_token_unique" ON "auth_refresh_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "auth_refresh_tokens_user_id_idx" ON "auth_refresh_tokens" USING btree ("user_id");
