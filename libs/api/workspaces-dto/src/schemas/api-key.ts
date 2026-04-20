import {z} from 'zod';

export const createApiKeyBodySchema = z.object({
  scopes: z.array(z.string()).min(1),
  ttl_seconds: z.number().int().positive().optional(),
});

export type CreateApiKeyBodyDto = z.infer<typeof createApiKeyBodySchema>;

export const createApiKeyResponseSchema = z.object({
  id: z.string().uuid(),
  raw_key: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});

export type CreateApiKeyResponseDto = z.infer<typeof createApiKeyResponseSchema>;

export const apiKeyDtoSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ApiKeyDto = z.infer<typeof apiKeyDtoSchema>;

export const revokeApiKeyResponseSchema = apiKeyDtoSchema;

export type RevokeApiKeyResponseDto = z.infer<typeof revokeApiKeyResponseSchema>;
