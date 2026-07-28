import {displayNameSchema} from '@shipfox/api-common-dto';
import {z} from 'zod';

export const workspaceStatusSchema = z.enum(['active', 'suspended', 'deleted']);

export const createWorkspaceBodySchema = z.object({
  name: displayNameSchema,
});

export type CreateWorkspaceBodyDto = z.infer<typeof createWorkspaceBodySchema>;

export const workspaceDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
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
