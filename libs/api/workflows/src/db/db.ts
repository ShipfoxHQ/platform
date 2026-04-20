import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {jobs} from './schema/jobs.js';
import {workflowsOutbox} from './schema/outbox.js';
import {steps} from './schema/steps.js';
import {workflowRuns} from './schema/workflow-runs.js';

export const schema = {workflowRuns, jobs, steps, workflowsOutbox};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
