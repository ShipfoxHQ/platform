import {z} from 'zod';

/**
 * Limits for values required to execute a workflow. These are deliberately
 * separate from the smaller limits used when an individual diagnostic read is
 * inlined in a response.
 */
export const RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES = 1_000_000;
export const RUNNER_NEXT_STEP_ENVELOPE_ALLOWANCE_BYTES = 128 * 1024;
export const MAX_RESOLVED_STEP_CONFIG_BYTES =
  RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES - RUNNER_NEXT_STEP_ENVELOPE_ALLOWANCE_BYTES;
export const MAX_LISTENER_TRIGGER_EVENTS_BYTES = 1_000_000;
/** Listener snapshots are bounded separately from product job-output totals. */
export const MAX_LISTENER_FILTER_SNAPSHOT_BYTES = 512 * 1024;
export const MAX_LISTENER_FIRE_EVENT_BYTES = 768 * 1024;

export const workflowExecutionPayloadFieldSchema = z.enum([
  'resolved_config',
  'authored_config',
  'config_plan',
  'condition',
  'listener_batch',
  'filter_snapshot',
]);

export type WorkflowExecutionPayloadFieldDto = z.infer<typeof workflowExecutionPayloadFieldSchema>;
