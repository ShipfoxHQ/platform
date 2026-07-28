import {z} from 'zod';
import {MAX_PROVISIONER_TOKEN_TTL_SECONDS} from './provisioner-token.js';

const timestampSchema = z.string().datetime();
const CONTROL_OR_FORMAT_CHARACTER_RE = /[\p{Cc}\p{Cf}]/u;
const reasonSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.trim().length > 0, {
    message: 'must not be blank',
  })
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  });

export const installationProvisionerTokenStatusSchema = z.enum(['active', 'expired', 'revoked']);

export type InstallationProvisionerTokenStatus = z.infer<
  typeof installationProvisionerTokenStatusSchema
>;

export const administratorProvisionerTokenSchema = z.object({
  id: z.string().uuid(),
  scope: z.literal('installation'),
  prefix: z.string().min(1),
  name: z.string().nullable(),
  status: installationProvisionerTokenStatusSchema,
  created_by_user_id: z.string().uuid(),
  revoked_by_user_id: z.string().uuid().nullable(),
  expires_at: timestampSchema.nullable(),
  revoked_at: timestampSchema.nullable(),
  last_seen_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type AdministratorProvisionerTokenDto = z.infer<typeof administratorProvisionerTokenSchema>;

export const createAdministratorProvisionerTokenBodySchema = z.object({
  name: z.string().min(1).max(256).optional(),
  ttl_seconds: z.number().int().positive().max(MAX_PROVISIONER_TOKEN_TTL_SECONDS).optional(),
  reason: reasonSchema,
});

export type CreateAdministratorProvisionerTokenBodyDto = z.infer<
  typeof createAdministratorProvisionerTokenBodySchema
>;

export const createAdministratorProvisionerTokenResponseSchema =
  administratorProvisionerTokenSchema.extend({
    raw_token: z.string().min(1),
    correlation_id: z.string().min(1).max(255),
  });

export type CreateAdministratorProvisionerTokenResponseDto = z.infer<
  typeof createAdministratorProvisionerTokenResponseSchema
>;

export const listAdministratorProvisionerTokensQuerySchema = z.object({
  status: installationProvisionerTokenStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type ListAdministratorProvisionerTokensQueryDto = z.infer<
  typeof listAdministratorProvisionerTokensQuerySchema
>;

export const listAdministratorProvisionerTokensResponseSchema = z.object({
  tokens: z.array(administratorProvisionerTokenSchema),
  next_cursor: z.string().nullable(),
});

export type ListAdministratorProvisionerTokensResponseDto = z.infer<
  typeof listAdministratorProvisionerTokensResponseSchema
>;

export const revokeAdministratorProvisionerTokenBodySchema = z.object({
  reason: reasonSchema,
});

export type RevokeAdministratorProvisionerTokenBodyDto = z.infer<
  typeof revokeAdministratorProvisionerTokenBodySchema
>;

export const revokeAdministratorProvisionerTokenResponseSchema =
  administratorProvisionerTokenSchema.extend({
    correlation_id: z.string().min(1).max(255),
  });

export type RevokeAdministratorProvisionerTokenResponseDto = z.infer<
  typeof revokeAdministratorProvisionerTokenResponseSchema
>;
