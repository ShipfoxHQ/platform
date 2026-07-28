import {z} from 'zod';

export const SESSION_VIEW_VERSION = 1;

const timestampSchema = z.number().int().nonnegative();

export const sessionViewRowMetaSchema = z.object({
  label: z.string().min(1),
  value: z.string(),
  inline: z.boolean().optional(),
});

const sessionViewRowBase = {
  timestamp: timestampSchema,
};

export const sessionViewMessageRowSchema = z.object({
  ...sessionViewRowBase,
  kind: z.literal('message'),
  role: z.string().min(1),
  label: z.string().min(1),
  meta: z.array(sessionViewRowMetaSchema).readonly(),
  text: z.string(),
  terminalFailure: z.boolean(),
});

export const sessionViewThinkingRowSchema = z.object({
  ...sessionViewRowBase,
  kind: z.literal('thinking'),
  text: z.string(),
});

export const sessionViewToolCallRowSchema = z.object({
  ...sessionViewRowBase,
  kind: z.literal('tool-call'),
  id: z.string().nullable(),
  name: z.string().min(1),
  input: z.string(),
  summary: z.string().optional(),
});

export const sessionViewToolResultRowSchema = z.object({
  ...sessionViewRowBase,
  kind: z.literal('tool-result'),
  toolCallId: z.string().nullable(),
  toolName: z.string().min(1),
  output: z.string(),
  isError: z.boolean(),
});

export const sessionViewLifecycleRowSchema = z.object({
  ...sessionViewRowBase,
  kind: z.literal('lifecycle'),
  label: z.string().min(1),
  detail: z.string().nullable(),
  meta: z.array(sessionViewRowMetaSchema).readonly(),
  tone: z.enum(['default', 'warning', 'error']),
  terminalFailure: z.boolean(),
});

export const sessionViewRawRowSchema = z.object({
  ...sessionViewRowBase,
  kind: z.literal('raw'),
  label: z.string().min(1),
  raw: z.string(),
});

export const sessionViewRowSchema = z.discriminatedUnion('kind', [
  sessionViewMessageRowSchema,
  sessionViewThinkingRowSchema,
  sessionViewToolCallRowSchema,
  sessionViewToolResultRowSchema,
  sessionViewLifecycleRowSchema,
  sessionViewRawRowSchema,
]);

export const sessionViewSchema = z.object({
  v: z.literal(SESSION_VIEW_VERSION),
  rows: z.array(sessionViewRowSchema).readonly(),
});

export type SessionViewRowMeta = z.infer<typeof sessionViewRowMetaSchema>;
export type SessionViewMessageRow = z.infer<typeof sessionViewMessageRowSchema>;
export type SessionViewThinkingRow = z.infer<typeof sessionViewThinkingRowSchema>;
export type SessionViewToolCallRow = z.infer<typeof sessionViewToolCallRowSchema>;
export type SessionViewToolResultRow = z.infer<typeof sessionViewToolResultRowSchema>;
export type SessionViewLifecycleRow = z.infer<typeof sessionViewLifecycleRowSchema>;
export type SessionViewRawRow = z.infer<typeof sessionViewRawRowSchema>;
export type SessionViewRow = z.infer<typeof sessionViewRowSchema>;
export type SessionViewDto = z.infer<typeof sessionViewSchema>;
