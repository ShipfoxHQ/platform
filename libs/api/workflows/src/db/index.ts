import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export {workflowsOutbox} from './schema/outbox.js';
export type {
  BulkUpdateStepStatusesParams,
  CreateWorkflowRunParams,
  UpdateJobStatusParams,
  UpdateWorkflowRunStatusParams,
} from './workflow-runs.js';
export {
  bulkUpdateStepStatuses,
  createWorkflowRun,
  getJobsByRunId,
  getStepsByJobId,
  getStepsByJobIds,
  getWorkflowRunById,
  listWorkflowRunsByProject,
  updateJobStatus,
  updateWorkflowRunStatus,
} from './workflow-runs.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
