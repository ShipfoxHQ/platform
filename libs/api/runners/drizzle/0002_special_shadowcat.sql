ALTER TABLE "runners_runner_instances" ADD COLUMN "first_claimed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "runners_runner_instances" AS instances
SET "first_claimed_at" = now()
FROM "runners_runner_sessions" AS sessions
WHERE instances."runner_session_id" = sessions."id"
  AND sessions."claims_used" > 0;
