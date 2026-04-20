import {z} from 'zod';

export const vcsProviderSchema = z.enum(['test', 'github', 'gitlab']);
export const vcsRepositoryVisibilitySchema = z.enum(['public', 'private', 'internal', 'unknown']);

export const createVcsConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  provider: vcsProviderSchema,
  provider_host: z.string().min(1).max(255),
  external_connection_id: z.string().min(1).max(255),
  display_name: z.string().min(1).max(255),
});

export type CreateVcsConnectionBodyDto = z.infer<typeof createVcsConnectionBodySchema>;

export const vcsConnectionDtoSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  provider: vcsProviderSchema,
  provider_host: z.string(),
  external_connection_id: z.string(),
  display_name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type VcsConnectionDto = z.infer<typeof vcsConnectionDtoSchema>;

export const repositoryDtoSchema = z.object({
  id: z.string().uuid(),
  vcs_connection_id: z.string().uuid(),
  provider: vcsProviderSchema,
  provider_host: z.string(),
  external_repository_id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  visibility: vcsRepositoryVisibilitySchema,
  clone_url: z.string(),
  html_url: z.string(),
  metadata_fetched_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type RepositoryDto = z.infer<typeof repositoryDtoSchema>;

export const createProjectBodySchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  vcs_connection_id: z.string().uuid(),
  external_repository_id: z.string().min(1).max(255),
});

export type CreateProjectBodyDto = z.infer<typeof createProjectBodySchema>;

export const projectDtoSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  repository_id: z.string().uuid(),
  name: z.string(),
  repository: repositoryDtoSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export type ProjectDto = z.infer<typeof projectDtoSchema>;

export const projectResponseSchema = projectDtoSchema;

export type ProjectResponseDto = z.infer<typeof projectResponseSchema>;

export const listProjectsQuerySchema = z.object({
  workspace_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type ListProjectsQueryDto = z.infer<typeof listProjectsQuerySchema>;

export const listProjectsResponseSchema = z.object({
  projects: z.array(projectDtoSchema),
  next_cursor: z.string().nullable(),
});

export type ListProjectsResponseDto = z.infer<typeof listProjectsResponseSchema>;
