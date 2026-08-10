CREATE TABLE "runners_terminal_job_executions" (
	"job_execution_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
