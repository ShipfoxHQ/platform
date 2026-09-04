import {
  DEFAULT_STEP_LOG_TAIL_LINES,
  MAX_STEP_LOG_TAIL_LINES,
} from '@shipfox/api-logs-dto/inter-module';
import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {idSchema, utf8CappedString} from './primitives.js';

export const AGENT_ACCESS_LOG_CONTENT_MAX_BYTES = 64 * 1024;
export const AGENT_ACCESS_LOG_SECTION_MAX_ITEMS = 10;
export const AGENT_ACCESS_LOG_TAIL_LINES_DEFAULT = DEFAULT_STEP_LOG_TAIL_LINES;
export const AGENT_ACCESS_LOG_TAIL_LINES_MAX = MAX_STEP_LOG_TAIL_LINES;
export const AGENT_ACCESS_LOG_ATTEMPT_MAX = 2_147_483_647;

const attemptSchema = z.number().int().min(1).max(AGENT_ACCESS_LOG_ATTEMPT_MAX);
const tailLinesSchema = z
  .number()
  .int()
  .min(1)
  .max(AGENT_ACCESS_LOG_TAIL_LINES_MAX)
  .default(AGENT_ACCESS_LOG_TAIL_LINES_DEFAULT);
const contentSchema = utf8CappedString(AGENT_ACCESS_LOG_CONTENT_MAX_BYTES);

export const getStepLogsInputSchema = z
  .object({
    step_id: idSchema.optional(),
    run_id: idSchema.optional(),
    attempt: attemptSchema.optional(),
    failed_only: z.literal(true).optional(),
    tail_lines: tailLinesSchema,
  })
  .superRefine((value, context) => {
    const hasStep = value.step_id !== undefined;
    const hasRun = value.run_id !== undefined;

    if (hasStep === hasRun) {
      context.addIssue({
        code: 'custom',
        path: [hasStep ? 'run_id' : 'step_id'],
        message: 'Provide exactly one of step_id or run_id',
      });
    }
    if (hasRun && value.failed_only !== true) {
      context.addIssue({
        code: 'custom',
        path: ['failed_only'],
        message: 'run_id requires failed_only to be true',
      });
    }
    if (hasStep && value.failed_only !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['failed_only'],
        message: 'failed_only is only valid with run_id',
      });
    }
    if (hasRun && value.attempt !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['attempt'],
        message: 'attempt is only valid with step_id',
      });
    }
  })
  .strict();

export type GetStepLogsInputDto = z.output<typeof getStepLogsInputSchema>;

const logSectionSchema = z
  .object({
    workflow_run_id: idSchema.optional(),
    workflow_run_attempt: attemptSchema.optional(),
    job_id: idSchema.optional(),
    job_execution_id: idSchema.optional(),
    step_id: idSchema,
    step_attempt_id: idSchema.optional(),
    attempt: attemptSchema,
    content: contentSchema,
    total_lines: z.number().int().nonnegative().optional(),
    content_truncated: z.literal(true).optional(),
    content_total_bytes: z.number().int().nonnegative().optional(),
    unavailable_reason: z.literal('compacted-log-unavailable').optional(),
  })
  .strict();

export const getStepLogsResultSchema = z
  .object({
    run_id: idSchema.optional(),
    workflow_run_attempt: attemptSchema.optional(),
    sections: z.array(logSectionSchema).max(AGENT_ACCESS_LOG_SECTION_MAX_ITEMS),
  })
  .superRefine((value, context) => {
    const hasRun = value.run_id !== undefined;
    const hasRunAttempt = value.workflow_run_attempt !== undefined;

    if (hasRun !== hasRunAttempt) {
      context.addIssue({
        code: 'custom',
        path: [hasRun ? 'workflow_run_attempt' : 'run_id'],
        message: 'run_id and workflow_run_attempt must be provided together',
      });
    }
    if (!hasRun && value.sections.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'A direct step read must contain exactly one section',
      });
    }
  })
  .strict();

export type GetStepLogsResultDto = z.output<typeof getStepLogsResultSchema>;

const uuid = {type: 'string', format: 'uuid'} as const;
const attempt = {
  type: 'integer',
  minimum: 1,
  maximum: AGENT_ACCESS_LOG_ATTEMPT_MAX,
} as const;

const directInputJsonSchema = {
  type: 'object',
  properties: {
    step_id: uuid,
    attempt,
    tail_lines: {
      type: 'integer',
      minimum: 1,
      maximum: AGENT_ACCESS_LOG_TAIL_LINES_MAX,
      default: AGENT_ACCESS_LOG_TAIL_LINES_DEFAULT,
    },
  },
  required: ['step_id'],
  additionalProperties: false,
} as const;

const failedOnlyInputJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuid,
    failed_only: {const: true},
    tail_lines: {
      type: 'integer',
      minimum: 1,
      maximum: AGENT_ACCESS_LOG_TAIL_LINES_MAX,
      default: AGENT_ACCESS_LOG_TAIL_LINES_DEFAULT,
    },
  },
  required: ['run_id', 'failed_only'],
  additionalProperties: false,
} as const;

export const getStepLogsInputJsonSchema = {
  type: 'object',
  oneOf: [directInputJsonSchema, failedOnlyInputJsonSchema],
} as const satisfies AgentAccessObjectSchema;

const logSectionJsonSchema = {
  type: 'object',
  properties: {
    workflow_run_id: uuid,
    workflow_run_attempt: attempt,
    job_id: uuid,
    job_execution_id: uuid,
    step_id: uuid,
    step_attempt_id: uuid,
    attempt,
    content: {type: 'string', maxLength: AGENT_ACCESS_LOG_CONTENT_MAX_BYTES},
    total_lines: {type: 'integer', minimum: 0},
    content_truncated: {const: true},
    content_total_bytes: {type: 'integer', minimum: 0},
    unavailable_reason: {const: 'compacted-log-unavailable'},
  },
  required: ['step_id', 'attempt', 'content'],
  additionalProperties: false,
} as const;

const directResultJsonSchema = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: logSectionJsonSchema,
    },
  },
  required: ['sections'],
  additionalProperties: false,
} as const;

const aggregateResultJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuid,
    workflow_run_attempt: attempt,
    sections: {
      type: 'array',
      maxItems: AGENT_ACCESS_LOG_SECTION_MAX_ITEMS,
      items: logSectionJsonSchema,
    },
  },
  required: ['run_id', 'workflow_run_attempt', 'sections'],
  additionalProperties: false,
} as const;

export const getStepLogsResultJsonSchema = {
  type: 'object',
  oneOf: [directResultJsonSchema, aggregateResultJsonSchema],
} as const satisfies AgentAccessObjectSchema;
