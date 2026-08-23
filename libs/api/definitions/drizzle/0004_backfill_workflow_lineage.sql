CREATE TEMP TABLE "definitions_workflow_lineage_backfill" ON COMMIT DROP AS
SELECT
	"d"."id" AS "definition_id",
	first_value("d"."id") OVER (
		PARTITION BY "d"."project_id", "d"."config_path"
		ORDER BY ("d"."ref" IS NOT NULL) DESC, "d"."id"
	) AS "workflow_id",
	"d"."project_id",
	"d"."config_path"
FROM "definitions_workflow_definitions" AS "d";--> statement-breakpoint
UPDATE "definitions_workflow_definitions"
SET "workflow_id" = NULL;--> statement-breakpoint
DELETE FROM "definitions_workflows";--> statement-breakpoint
INSERT INTO "definitions_workflows" ("id", "project_id", "config_path")
SELECT DISTINCT ON ("project_id", "config_path")
	"workflow_id", "project_id", "config_path"
FROM "definitions_workflow_lineage_backfill"
ORDER BY "project_id", "config_path", "workflow_id";--> statement-breakpoint
UPDATE "definitions_workflow_definitions" AS "d"
SET "workflow_id" = "b"."workflow_id"
FROM "definitions_workflow_lineage_backfill" AS "b"
WHERE "b"."definition_id" = "d"."id";--> statement-breakpoint
ALTER TABLE "definitions_workflow_definitions"
	ALTER COLUMN "workflow_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "definitions_workflow_definitions"
	VALIDATE CONSTRAINT "definitions_workflow_definitions_workflow_id_definitions_workflows_id_fk";
