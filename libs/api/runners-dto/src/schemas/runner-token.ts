import {z} from 'zod';

export const createRunnerTokenBodySchema = z.object({
  name: z.string().min(1).optional(),
  ttl_seconds: z.number().int().positive().optional(),
});

export type CreateRunnerTokenBodyDto = z.infer<typeof createRunnerTokenBodySchema>;

export const createRunnerTokenResponseSchema = z.object({
  id: z.string().uuid(),
  raw_token: z.string(),
  prefix: z.string(),
  name: z.string().nullable(),
  workspace_id: z.string().uuid(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});

export type CreateRunnerTokenResponseDto = z.infer<typeof createRunnerTokenResponseSchema>;

export const runnerTokenDtoSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  prefix: z.string(),
  name: z.string().nullable(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type RunnerTokenDto = z.infer<typeof runnerTokenDtoSchema>;

export const revokeRunnerTokenResponseSchema = runnerTokenDtoSchema;

export type RevokeRunnerTokenResponseDto = z.infer<typeof revokeRunnerTokenResponseSchema>;
