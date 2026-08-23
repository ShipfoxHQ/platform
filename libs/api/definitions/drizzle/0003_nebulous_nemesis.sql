CREATE TABLE "definitions_workflows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"config_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "definitions_workflow_definitions" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_workflows_project_path_unique" ON "definitions_workflows" USING btree ("project_id","config_path");--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_workflows_project_pathless_unique" ON "definitions_workflows" USING btree ("project_id") WHERE "config_path" IS NULL;--> statement-breakpoint
ALTER TABLE "definitions_workflow_definitions" ADD CONSTRAINT "definitions_workflow_definitions_workflow_id_definitions_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."definitions_workflows"("id") ON DELETE no action ON UPDATE no action NOT VALID;
