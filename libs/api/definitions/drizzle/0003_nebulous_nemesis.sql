CREATE TABLE "definitions_workflows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"config_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "definitions_workflow_definitions" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
INSERT INTO "definitions_workflows" ("id", "project_id", "config_path")
SELECT DISTINCT ON ("project_id", "config_path") "id", "project_id", "config_path"
FROM "definitions_workflow_definitions"
WHERE "config_path" IS NOT NULL
ORDER BY "project_id", "config_path", ("ref" IS NOT NULL) DESC, "id";--> statement-breakpoint
INSERT INTO "definitions_workflows" ("id", "project_id", "config_path")
SELECT DISTINCT ON ("project_id") "id", "project_id", NULL
FROM "definitions_workflow_definitions"
WHERE "config_path" IS NULL
ORDER BY "project_id", "id";--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_workflows_project_path_unique" ON "definitions_workflows" USING btree ("project_id","config_path");--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_workflows_project_pathless_unique" ON "definitions_workflows" USING btree ("project_id") WHERE "config_path" IS NULL;--> statement-breakpoint
UPDATE "definitions_workflow_definitions" AS "d"
SET "workflow_id" = "w"."id"
FROM "definitions_workflows" AS "w"
WHERE "d"."config_path" IS NOT NULL
	AND "w"."project_id" = "d"."project_id"
	AND "w"."config_path" = "d"."config_path";--> statement-breakpoint
UPDATE "definitions_workflow_definitions" AS "d"
SET "workflow_id" = "w"."id"
FROM "definitions_workflows" AS "w"
WHERE "d"."config_path" IS NULL
	AND "w"."project_id" = "d"."project_id"
	AND "w"."config_path" IS NULL;--> statement-breakpoint
ALTER TABLE "definitions_workflow_definitions" ALTER COLUMN "workflow_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "definitions_workflow_definitions" ADD CONSTRAINT "definitions_workflow_definitions_workflow_id_definitions_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."definitions_workflows"("id") ON DELETE no action ON UPDATE no action;
