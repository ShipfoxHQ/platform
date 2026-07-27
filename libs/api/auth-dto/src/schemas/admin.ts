import {emailSchema} from '@shipfox/api-common-dto';
import {z} from 'zod';
import {userStatusSchema} from './user.js';

export const adminRoleSchema = z.enum(['admin-observer', 'admin-operator', 'admin-owner']);

export type AdminRole = z.infer<typeof adminRoleSchema>;

const timestampSchema = z.string().datetime();
const identifierEmailSchema = z.string().email();
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

export const administratorUserIdentitySchema = z.object({
  id: z.string().uuid(),
  email: identifierEmailSchema,
  name: z.string().nullable(),
  status: userStatusSchema,
});

export type AdministratorUserIdentityDto = z.infer<typeof administratorUserIdentitySchema>;

export const administratorUserSummarySchema = administratorUserIdentitySchema.extend({
  email_verified_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  admin_role: adminRoleSchema.nullable(),
});

export type AdministratorUserSummaryDto = z.infer<typeof administratorUserSummarySchema>;

export const administratorUserLookupQuerySchema = z
  .object({
    id: z.string().uuid().optional(),
    user_id: z.string().uuid().optional(),
    email: emailSchema.optional(),
  })
  .superRefine((value, context) => {
    const identifiers = [value.id, value.user_id, value.email].filter(
      (identifier) => identifier !== undefined,
    );
    if (identifiers.length !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'provide exactly one of id, user_id, or email',
        path: [],
      });
    }
  });

export type AdministratorUserLookupQueryDto = z.infer<typeof administratorUserLookupQuerySchema>;

export const administratorGrantSummarySchema = z.object({
  grant_id: z.string().uuid(),
  role: adminRoleSchema,
  created_at: timestampSchema,
  revoked_at: timestampSchema.nullable(),
  user: administratorUserIdentitySchema,
});

export type AdministratorGrantSummaryDto = z.infer<typeof administratorGrantSummarySchema>;

export const listAdminGrantsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type ListAdminGrantsQueryDto = z.infer<typeof listAdminGrantsQuerySchema>;

export const listAdminGrantsResponseSchema = z.object({
  grants: z.array(administratorGrantSummarySchema),
  next_cursor: z.string().nullable(),
});

export type ListAdminGrantsResponseDto = z.infer<typeof listAdminGrantsResponseSchema>;
