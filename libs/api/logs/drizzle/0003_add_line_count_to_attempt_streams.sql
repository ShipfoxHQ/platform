ALTER TABLE "logs_attempt_streams" ADD COLUMN "line_count" bigint;--> statement-breakpoint
ALTER TABLE "logs_attempt_streams" ADD COLUMN "compaction_upload_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;
