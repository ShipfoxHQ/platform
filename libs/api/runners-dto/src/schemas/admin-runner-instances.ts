import {MAX_RUNNER_LABELS} from '@shipfox/runner-labels';
import {z} from 'zod';
import {runnerLabelSchema} from './register.js';
import {providerRunnerStateSchema} from './report-runner-instances.js';

export const runnerAdministratorLifecycleStateSchema = z.enum([
  'unassigned',
  'assigned',
  'activated',
  'claimed',
  'completed',
]);

export const runnerAdministratorEnrollmentStateSchema = z.enum([
  'pending',
  'enrolled',
  'activated',
]);

export const runnerAdministratorAssignmentPresenceSchema = z.enum(['assigned', 'unassigned']);

export const runnerAdministratorReconciliationStatusSchema = z.enum([
  'current',
  'stale',
  'terminal',
  'unknown',
]);

const runnerAdministratorAssignedWorkspaceSchema = z.object({
  id: z.string().uuid(),
});

const runnerAdministratorProvisionerSchema = z.object({
  id: z.string().uuid(),
  scope: z.literal('installation'),
  name: z.string().nullable(),
});

export const runnerAdministratorInstanceSchema = z.object({
  id: z.string().uuid(),
  lifecycle_state: runnerAdministratorLifecycleStateSchema,
  compute_state: providerRunnerStateSchema,
  enrollment_state: runnerAdministratorEnrollmentStateSchema,
  assignment_presence: runnerAdministratorAssignmentPresenceSchema,
  assigned_workspace: runnerAdministratorAssignedWorkspaceSchema.nullable(),
  labels: z.array(runnerLabelSchema).max(MAX_RUNNER_LABELS),
  created_at: z.string().datetime(),
  last_heartbeat_at: z.string().datetime(),
  closure_reason: z.string().max(500).nullable(),
  closed_at: z.string().datetime().nullable(),
  provisioner: runnerAdministratorProvisionerSchema,
  reconciliation_status: runnerAdministratorReconciliationStatusSchema,
});

export type RunnerAdministratorInstanceDto = z.infer<typeof runnerAdministratorInstanceSchema>;

export const listRunnerAdministratorInstancesQuerySchema = z.object({
  state: providerRunnerStateSchema.optional(),
  assignment: runnerAdministratorAssignmentPresenceSchema.optional(),
  label: runnerLabelSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type ListRunnerAdministratorInstancesQueryDto = z.infer<
  typeof listRunnerAdministratorInstancesQuerySchema
>;

export const listRunnerAdministratorInstancesResponseSchema = z.object({
  runners: z.array(runnerAdministratorInstanceSchema),
  next_cursor: z.string().nullable(),
});

export type ListRunnerAdministratorInstancesResponseDto = z.infer<
  typeof listRunnerAdministratorInstancesResponseSchema
>;
