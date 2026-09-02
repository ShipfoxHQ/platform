import {z} from 'zod';

export const AGENT_ACCESS_ERROR_CODE_MAX_LENGTH = 128;
export const AGENT_ACCESS_ERROR_MESSAGE_MAX_LENGTH = 2048;

const agentAccessErrorCodeSchema = z.string().min(1).max(AGENT_ACCESS_ERROR_CODE_MAX_LENGTH);

/** A bounded error payload shared by every agent-access tool. */
export const agentAccessErrorSchema = z
  .object({
    code: agentAccessErrorCodeSchema,
    message: z.string().max(AGENT_ACCESS_ERROR_MESSAGE_MAX_LENGTH).optional(),
    retry_after_seconds: z.number().int().min(1).optional(),
  })
  .strict();

export type AgentAccessErrorDto = z.infer<typeof agentAccessErrorSchema>;

/**
 * The wire envelope for both successful and failed tool calls. The relation
 * between `ok` and the optional payload is checked at runtime below rather
 * than represented as a top-level JSON-schema union.
 */
export const agentAccessEnvelopeSchema = z
  .object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: agentAccessErrorSchema.optional(),
    response_truncated: z.boolean().optional(),
    response_total_bytes: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.ok && value.result === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Successful responses must include result',
      });
    }
    if (value.ok && value.error !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Successful responses must not include error',
      });
    }
    if (!value.ok && value.error === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Failed responses must include error',
      });
    }
    if (!value.ok && value.result !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Failed responses must not include result',
      });
    }
  });

export type AgentAccessEnvelopeDto = z.infer<typeof agentAccessEnvelopeSchema>;

export interface AgentAccessJsonSchema {
  readonly type?: string;
  readonly [key: string]: unknown;
}

export interface AgentAccessObjectSchema extends AgentAccessJsonSchema {
  readonly type: 'object';
}

const agentAccessEnvelopeProperties = {
  ok: {type: 'boolean'},
  result: {},
  error: {
    type: 'object',
    properties: {
      code: {type: 'string', minLength: 1, maxLength: AGENT_ACCESS_ERROR_CODE_MAX_LENGTH},
      message: {type: 'string', maxLength: AGENT_ACCESS_ERROR_MESSAGE_MAX_LENGTH},
      retry_after_seconds: {type: 'integer', minimum: 1},
    },
    required: ['code'],
    additionalProperties: false,
  },
  response_truncated: {type: 'boolean'},
  response_total_bytes: {type: 'integer', minimum: 0},
} as const;

/** JSON Schema form used in MCP tool descriptors. It intentionally has no top-level oneOf. */
export const agentAccessEnvelopeJsonSchema = {
  type: 'object',
  properties: agentAccessEnvelopeProperties,
  required: ['ok'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

/** Adds a tool-specific result schema while preserving the common envelope. */
export function agentAccessOutputSchema(
  resultSchema: AgentAccessJsonSchema = {},
): AgentAccessObjectSchema {
  return {
    ...agentAccessEnvelopeJsonSchema,
    properties: {...agentAccessEnvelopeProperties, result: resultSchema},
  };
}
