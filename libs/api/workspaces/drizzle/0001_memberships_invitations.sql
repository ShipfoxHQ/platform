CREATE TABLE "workspaces_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"hashed_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"invited_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces_memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_email" text NOT NULL,
	"user_name" text,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces_invitations" ADD CONSTRAINT "workspaces_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces_memberships" ADD CONSTRAINT "workspaces_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_invitations_hashed_token_unique" ON "workspaces_invitations" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "workspaces_invitations_workspace_email_idx" ON "workspaces_invitations" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_memberships_user_workspace_unique" ON "workspaces_memberships" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "workspaces_memberships_workspace_id_idx" ON "workspaces_memberships" USING btree ("workspace_id");
