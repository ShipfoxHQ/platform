ALTER TABLE "integrations_jira_installations" ADD COLUMN "refresh_token_last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integrations_jira_installations" ADD COLUMN "refresh_token_last_attempted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "integrations_jira_installations"
SET
  "refresh_token_last_used_at" = "created_at",
  "refresh_token_last_attempted_at" = "created_at";--> statement-breakpoint
ALTER TABLE "integrations_jira_installations" ALTER COLUMN "refresh_token_last_used_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "integrations_jira_installations" ALTER COLUMN "refresh_token_last_used_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations_jira_installations" ALTER COLUMN "refresh_token_last_attempted_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "integrations_jira_installations" ALTER COLUMN "refresh_token_last_attempted_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "integrations_jira_installations_token_refresh_due_idx" ON "integrations_jira_installations" USING btree ("status","refresh_token_last_used_at");--> statement-breakpoint
CREATE INDEX "integrations_jira_installations_token_refresh_attempt_idx" ON "integrations_jira_installations" USING btree ("status","refresh_token_last_attempted_at");
