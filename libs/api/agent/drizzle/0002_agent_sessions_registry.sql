CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workflow_run_attempt_id" uuid NOT NULL,
	"key" text NOT NULL,
	"harness" text NOT NULL,
	"harness_session_id" text,
	"head_segment" integer DEFAULT 0 NOT NULL,
	"head_object_key" text,
	"head_size_bytes" bigint,
	"head_committed_by_attempt" uuid,
	"head_repo_ref" text,
	"claimed_by_step_attempt" uuid,
	"claimed_at" timestamp with time zone,
	"carried_from_session_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_sessions_run_key_unique" ON "agent_sessions" USING btree ("workflow_run_attempt_id","key");