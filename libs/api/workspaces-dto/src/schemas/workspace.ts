import {displayNameSchema, slugSchema} from '@shipfox/api-common-dto';
import {z} from 'zod';

export const workspaceStatusSchema = z.enum(['active', 'suspended', 'deleted']);

export const createWorkspaceBodySchema = z.object({
  name: displayNameSchema,
  slug: slugSchema,
});

export type CreateWorkspaceBodyDto = z.infer<typeof createWorkspaceBodySchema>;

export const updateWorkspaceBodySchema = z
  .object({
    name: displayNameSchema.optional(),
    slug: slugSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.slug !== undefined, {
    message: 'At least one of name or slug is required',
  });

export type UpdateWorkspaceBodyDto = z.infer<typeof updateWorkspaceBodySchema>;

export const workspaceDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: slugSchema,
  status: workspaceStatusSchema,
  settings: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;

export const workspaceResponseSchema = workspaceDtoSchema;

export type WorkspaceResponseDto = z.infer<typeof workspaceResponseSchema>;

export const workspaceAdminLookupQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  status: workspaceStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type WorkspaceAdminLookupQueryDto = z.infer<typeof workspaceAdminLookupQuerySchema>;

const CONTROL_OR_FORMAT_CHARACTER_RE = /[\p{Cc}\p{Cf}]/u;
const workspaceAdministrationReasonSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  });

export const workspaceAdministrationMutationBodySchema = z.object({
  reason: workspaceAdministrationReasonSchema,
});

export type WorkspaceAdministrationMutationBodyDto = z.infer<
  typeof workspaceAdministrationMutationBodySchema
>;

export const workspaceAdministrationMutationResponseSchema = z.object({
  workspace_id: z.string().uuid(),
  status: workspaceStatusSchema,
  correlation_id: z.string().min(1),
});

export type WorkspaceAdministrationMutationResponseDto = z.infer<
  typeof workspaceAdministrationMutationResponseSchema
>;

export const workspaceAdminMemberSummarySchema = z.object({
  count: z.number().int().nonnegative(),
});

export const workspaceAdminProjectSummarySchema = z.discriminatedUnion('state', [
  z.object({state: z.literal('available'), count: z.number().int().nonnegative()}),
  z.object({state: z.literal('unknown')}),
]);

export const workspaceAdminJobCountsSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('available'),
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
  }),
  z.object({state: z.literal('unknown')}),
]);

export const workspaceAdminSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: workspaceStatusSchema,
  member_summary: workspaceAdminMemberSummarySchema,
  project_summary: workspaceAdminProjectSummarySchema,
  job_counts: workspaceAdminJobCountsSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type WorkspaceAdminSummaryDto = z.infer<typeof workspaceAdminSummarySchema>;

export const listWorkspaceAdminSummariesResponseSchema = z.object({
  workspaces: z.array(workspaceAdminSummarySchema),
  next_cursor: z.string().nullable(),
});

export type ListWorkspaceAdminSummariesResponseDto = z.infer<
  typeof listWorkspaceAdminSummariesResponseSchema
>;
