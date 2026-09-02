WITH "redacted" ("body") AS (
	VALUES ($body$**Step failed**

Shipfox could not complete this step. Try again or review the step logs.$body$)
)
UPDATE "annotations_annotations" AS "annotation"
SET
	"body" = "redacted"."body",
	"body_bytes" = octet_length("redacted"."body"),
	"updated_at" = now()
FROM "redacted"
WHERE
	"annotation"."style" = 'error'
	AND "annotation"."context" = 'failure:step:' || "annotation"."origin_step_id"::text
	AND position(E'\n\nReason: ' IN "annotation"."body") > 0
	AND position(E'\nExit code: ' IN "annotation"."body") > 0;
--> statement-breakpoint
WITH "redacted" ("body") AS (
	VALUES ($body$**Job could not finish**

Try the job again. If the problem continues, contact support.$body$)
)
UPDATE "annotations_annotations" AS "annotation"
SET
	"body" = "redacted"."body",
	"body_bytes" = octet_length("redacted"."body"),
	"updated_at" = now()
FROM "redacted"
WHERE
	"annotation"."style" = 'error'
	AND "annotation"."context" = 'failure:job:' || "annotation"."job_id"::text
	AND "annotation"."body" LIKE E'**Job failed before completion**\n\n%'
	AND position(E'\nReason: ' IN "annotation"."body") > 0;
