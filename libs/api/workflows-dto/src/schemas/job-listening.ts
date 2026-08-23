import {z} from 'zod';

export const jobModeSchema = z.enum(['one_shot', 'listening']);
export const listenerStatusSchema = z.enum(['inactive', 'listening', 'resolved']);
export const resolutionReasonSchema = z.enum(['until', 'timeout', 'max_executions', 'cancelled']);

export const listeningTriggerSchema = z.object({
  source: z.string(),
  event: z.string().optional(),
  inputs: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().optional(),
});

export const jobListeningBatchSchema = z.object({
  debounce_ms: z.number().int().positive().optional(),
  max_size: z.number().int().positive().optional(),
  max_wait_ms: z.number().int().positive().optional(),
});

export const jobListeningSchema = z.object({
  on: z.array(listeningTriggerSchema).min(1),
  until: z.array(listeningTriggerSchema).min(1).nullable(),
  timeout_ms: z.number().int().positive().nullable(),
  max_executions: z.number().int().positive().nullable(),
  batch: jobListeningBatchSchema.nullable(),
  on_resolve: z.enum(['finish', 'cancel']),
  execution_timeout_ms: z.number().int().positive().nullable(),
  name: z.string().nullable(),
});

export const workflowExecutionEventSchema = z.object({
  source: z.string(),
  event: z.string(),
  delivery_id: z.string(),
  received_at: z.string(),
  project: z.object({id: z.string().uuid()}).nullable(),
  repository: z.string().nullable(),
  ref: z.string().nullable(),
  commit: z.string().nullable(),
  data: z.unknown(),
});

export const workflowExecutionContextSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
  status: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  events: z.array(workflowExecutionEventSchema),
});

export const triggerEventsBatchSchema = z.object({
  events: z.array(workflowExecutionEventSchema),
});

export type JobModeDto = z.infer<typeof jobModeSchema>;
export type ListenerStatusDto = z.infer<typeof listenerStatusSchema>;
export type ResolutionReasonDto = z.infer<typeof resolutionReasonSchema>;
export type ListeningTriggerDto = z.infer<typeof listeningTriggerSchema>;
export type JobListeningDto = z.infer<typeof jobListeningSchema>;
export type WorkflowExecutionEventDto = z.infer<typeof workflowExecutionEventSchema>;
export type WorkflowExecutionContextDto = z.infer<typeof workflowExecutionContextSchema>;
export type TriggerEventsBatchDto = z.infer<typeof triggerEventsBatchSchema>;
