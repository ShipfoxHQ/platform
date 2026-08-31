CREATE TYPE "public"."workflows_checkout_renewal_subject_status" AS ENUM('pending', 'promoted');--> statement-breakpoint
CREATE TABLE "workflows_checkout_renewal_subjects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"step_id" uuid NOT NULL,
	"workflow_run_attempt_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" "workflows_checkout_renewal_subject_status" DEFAULT 'pending' NOT NULL,
	"repository_url" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_repository_id" text NOT NULL,
	"permissions_contents" "workflows_checkout_contents" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_at" timestamp with time zone,
	CONSTRAINT "workflows_crs_attempt_positive_ck" CHECK ("workflows_checkout_renewal_subjects"."attempt" > 0),
	CONSTRAINT "workflows_crs_promoted_at_ck" CHECK (("workflows_checkout_renewal_subjects"."status" = 'pending' and "workflows_checkout_renewal_subjects"."promoted_at" is null) or ("workflows_checkout_renewal_subjects"."status" = 'promoted' and "workflows_checkout_renewal_subjects"."promoted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "workflows_checkout_renewal_subjects" ADD CONSTRAINT "workflows_checkout_renewal_subjects_step_id_workflows_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."workflows_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_checkout_renewal_subjects" ADD CONSTRAINT "workflows_checkout_renewal_subjects_workflow_run_attempt_id_workflows_workflow_run_attempts_id_fk" FOREIGN KEY ("workflow_run_attempt_id") REFERENCES "public"."workflows_workflow_run_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_crs_step_id_attempt_uq" ON "workflows_checkout_renewal_subjects" USING btree ("step_id","attempt");--> statement-breakpoint
CREATE INDEX "workflows_crs_workflow_run_attempt_id_idx" ON "workflows_checkout_renewal_subjects" USING btree ("workflow_run_attempt_id");