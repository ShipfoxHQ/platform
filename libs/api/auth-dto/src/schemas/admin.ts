import {z} from 'zod';

export const adminRoleSchema = z.enum(['admin-observer', 'admin-operator', 'admin-owner']);

export type AdminRole = z.infer<typeof adminRoleSchema>;

const timestampSchema = z.string().datetime();
const CONTROL_OR_FORMAT_CHARACTER_RE = /[\p{Cc}\p{Cf}]/u;
const reasonSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  });

export const adminGrantDtoSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: adminRoleSchema,
  revoked_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type AdminGrantDto = z.infer<typeof adminGrantDtoSchema>;

export const listAdminGrantsResponseSchema = z.object({
  grants: z.array(adminGrantDtoSchema),
});

export type ListAdminGrantsResponseDto = z.infer<typeof listAdminGrantsResponseSchema>;

export const bootstrapAdminOwnerBodySchema = z.object({
  bootstrap_token: z.string().min(1).max(512),
});

export type BootstrapAdminOwnerBodyDto = z.infer<typeof bootstrapAdminOwnerBodySchema>;

export const bootstrapAdminOwnerResponseSchema = adminGrantDtoSchema;

export type BootstrapAdminOwnerResponseDto = z.infer<typeof bootstrapAdminOwnerResponseSchema>;

export const grantAdminRoleBodySchema = z.object({
  user_id: z.string().uuid(),
  role: adminRoleSchema,
  reason: reasonSchema,
});

export type GrantAdminRoleBodyDto = z.infer<typeof grantAdminRoleBodySchema>;

export const grantAdminRoleResponseSchema = adminGrantDtoSchema;

export type GrantAdminRoleResponseDto = z.infer<typeof grantAdminRoleResponseSchema>;

export const revokeAdminGrantBodySchema = z.object({
  reason: reasonSchema,
});

export type RevokeAdminGrantBodyDto = z.infer<typeof revokeAdminGrantBodySchema>;

export const revokeAdminGrantResponseSchema = adminGrantDtoSchema;

export type RevokeAdminGrantResponseDto = z.infer<typeof revokeAdminGrantResponseSchema>;
