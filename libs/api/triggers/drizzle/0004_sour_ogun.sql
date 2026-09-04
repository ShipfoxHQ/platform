ALTER TABLE "triggers_decisions" ADD COLUMN "diagnostic" jsonb;--> statement-breakpoint
ALTER TABLE "triggers_received_events" ADD COLUMN "processing_diagnostic" jsonb;