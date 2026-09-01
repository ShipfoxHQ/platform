ALTER TABLE "logs_attempt_streams" ADD COLUMN "line_count" bigint;
ALTER TABLE "logs_attempt_streams" ADD COLUMN "compaction_reconciled_at" timestamp with time zone;
CREATE INDEX "logs_attempt_streams_compaction_reconciliation_idx" ON "logs_attempt_streams" USING btree ("closed_at","compaction_reconciled_at") WHERE "state" = 'closed' and "object_key" is not null;
