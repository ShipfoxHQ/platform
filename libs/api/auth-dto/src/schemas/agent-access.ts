import {z} from 'zod';

const timestampSchema = z.string().datetime();
const scopeSchema = z.literal('read');
const textEncoder = new TextEncoder();
const CONTROL_OR_FORMAT_CHARACTER_RE = /[\p{Cc}\p{Cf}]/u;

/** Names displayed in the agent-access UI reject invisible control characters. */
export const agentAccessNameSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => textEncoder.encode(value).byteLength <= 256, {
    message: 'must be at most 256 UTF-8 bytes',
  })
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  });

const agentPersonalAccessTokenNameSchema = agentAccessNameSchema;

/** The dashboard-safe representation of an OAuth agent grant. */
export const agentGrantSummarySchema = z
  .object({
    id: z.string().uuid(),
    client_name: agentAccessNameSchema,
    workspace_id: z.string().uuid(),
    scopes: z.array(scopeSchema).min(1),
    created_at: timestampSchema,
    last_refreshed_at: timestampSchema.nullable(),
  })
  .strict();

export type AgentGrantSummaryDto = z.infer<typeof agentGrantSummarySchema>;

export const listAgentGrantsResponseSchema = z
  .object({grants: z.array(agentGrantSummarySchema)})
  .strict();

export type ListAgentGrantsResponseDto = z.infer<typeof listAgentGrantsResponseSchema>;

/** The dashboard-safe representation of a PAT; the raw value is never included. */
export const agentPersonalAccessTokenSummarySchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    prefix: z.string().min(1).max(64),
    name: agentPersonalAccessTokenNameSchema,
    expires_at: timestampSchema,
    last_used_at: timestampSchema.nullable(),
    created_at: timestampSchema,
  })
  .strict();

export type AgentPersonalAccessTokenSummaryDto = z.infer<
  typeof agentPersonalAccessTokenSummarySchema
>;

export const listAgentPersonalAccessTokensResponseSchema = z
  .object({pats: z.array(agentPersonalAccessTokenSummarySchema)})
  .strict();

export type ListAgentPersonalAccessTokensResponseDto = z.infer<
  typeof listAgentPersonalAccessTokensResponseSchema
>;

export const createAgentPersonalAccessTokenBodySchema = z
  .object({
    workspace_id: z.string().uuid(),
    name: agentPersonalAccessTokenNameSchema,
    expires_in_days: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(90),
  })
  .strict();

export type CreateAgentPersonalAccessTokenBodyDto = z.infer<
  typeof createAgentPersonalAccessTokenBodySchema
>;

export const createAgentPersonalAccessTokenResponseSchema = z
  .object({
    raw_token: z.string().min(1),
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    prefix: z.string().min(1).max(64),
    name: agentPersonalAccessTokenNameSchema,
    expires_at: timestampSchema,
    last_used_at: timestampSchema.nullable(),
    created_at: timestampSchema,
  })
  .strict();

export type CreateAgentPersonalAccessTokenResponseDto = z.infer<
  typeof createAgentPersonalAccessTokenResponseSchema
>;

export const agentAccessCredentialParamsSchema = z.object({id: z.string().uuid()}).strict();

export type AgentAccessCredentialParamsDto = z.infer<typeof agentAccessCredentialParamsSchema>;
