CREATE TYPE "public"."auth_admin_role" AS ENUM('admin-observer', 'admin-operator', 'admin-owner');--> statement-breakpoint
CREATE TABLE "auth_admin_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "auth_admin_role" NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_admin_grants" ADD CONSTRAINT "auth_admin_grants_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_admin_grants_user_id_idx" ON "auth_admin_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_admin_grants_active_owners_idx" ON "auth_admin_grants" USING btree ("user_id") WHERE "auth_admin_grants"."role" = 'admin-owner' AND "auth_admin_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_admin_grants_active_user_role_unique" ON "auth_admin_grants" USING btree ("user_id","role") WHERE "auth_admin_grants"."revoked_at" IS NULL;--> statement-breakpoint
