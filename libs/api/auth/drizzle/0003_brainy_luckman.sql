CREATE INDEX "auth_users_created_at_id_index" ON "auth_users" USING btree ("created_at" desc,"id" desc);--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "auth_users" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "auth_users" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
CREATE INDEX "auth_users_name_trgm_index" ON "auth_users" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "auth_users_email_trgm_index" ON "auth_users" USING gin ("email" gin_trgm_ops);
