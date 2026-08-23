CREATE INDEX "definitions_wd_workflow_ref_lookup" ON "definitions_workflow_definitions" USING btree ("workflow_id","ref") WHERE "ref" IS NOT NULL AND "deleted_at" IS NULL;
