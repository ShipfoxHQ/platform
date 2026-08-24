CREATE INDEX "agent_sessions_claimed_by_step_attempt_idx" ON "agent_sessions" USING btree ("claimed_by_step_attempt");
--> statement-breakpoint
CREATE INDEX "agent_sessions_claimed_at_partial_idx" ON "agent_sessions" USING btree ("claimed_at") WHERE "claimed_by_step_attempt" IS NOT NULL;
