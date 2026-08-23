ALTER TABLE "triggers_job_listener_subscriptions" ALTER COLUMN "event" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "triggers_subscriptions" ALTER COLUMN "event" DROP NOT NULL;--> statement-breakpoint
