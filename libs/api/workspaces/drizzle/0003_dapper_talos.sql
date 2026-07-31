CREATE TABLE "workspaces_rate_limits" (
	"action" text NOT NULL,
	"scope" text NOT NULL,
	"identifier_hmac" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_rate_limits_window_unique" ON "workspaces_rate_limits" USING btree ("action","scope","identifier_hmac","window_start");--> statement-breakpoint
CREATE INDEX "workspaces_rate_limits_expires_at_idx" ON "workspaces_rate_limits" USING btree ("expires_at");--> statement-breakpoint
