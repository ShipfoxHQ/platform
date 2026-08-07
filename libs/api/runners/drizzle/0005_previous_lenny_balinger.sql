CREATE TYPE "public"."runners_reservation_kind" AS ENUM('bound', 'launch');--> statement-breakpoint
ALTER TABLE "runners_reservations" ADD COLUMN "kind" "runners_reservation_kind" DEFAULT 'launch' NOT NULL;--> statement-breakpoint
CREATE TYPE "public"."runners_provider_runner_launch_kind" AS ENUM('demand', 'warm', 'manual');--> statement-breakpoint
ALTER TABLE "runners_runner_instances" ADD COLUMN "launch_kind" "runners_provider_runner_launch_kind" DEFAULT 'manual' NOT NULL;
