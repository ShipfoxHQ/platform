import {z} from 'zod';

export const CONNECTION_SLUG_MAX_LENGTH = 100;

/**
 * Slugs sync classifies by literal: a source equal to one of these names is a
 * built-in trigger source, never a connection. No provider may allocate a
 * connection holding one of them.
 */
export const RESERVED_CONNECTION_SLUGS = ['manual', 'cron'] as const;

export const connectionSlugSchema = z
  .string()
  .min(1)
  .max(CONNECTION_SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/);

export const integrationProviderKindSchema = z.string().min(1);
export type IntegrationProviderKindDto = z.infer<typeof integrationProviderKindSchema>;

export const integrationCapabilitySchema = z.enum(['source_control', 'agent_tools']);
export type IntegrationCapabilityDto = z.infer<typeof integrationCapabilitySchema>;

export const integrationConnectionLifecycleStatusSchema = z.enum(['active', 'disabled', 'error']);
export type IntegrationConnectionLifecycleStatusDto = z.infer<
  typeof integrationConnectionLifecycleStatusSchema
>;
export const integrationConnectionRepositoryAccessModeSchema = z.enum(['selected', 'all']);
export type IntegrationConnectionRepositoryAccessModeDto = z.infer<
  typeof integrationConnectionRepositoryAccessModeSchema
>;
export const updateIntegrationConnectionLifecycleStatusSchema = z.enum(['active', 'disabled']);
export type UpdateIntegrationConnectionLifecycleStatusDto = z.infer<
  typeof updateIntegrationConnectionLifecycleStatusSchema
>;

export const repositoryVisibilitySchema = z.enum(['public', 'private', 'internal', 'unknown']);
export type RepositoryVisibilityDto = z.infer<typeof repositoryVisibilitySchema>;

export const integrationProviderDtoSchema = z.object({
  provider: integrationProviderKindSchema,
  display_name: z.string(),
  capabilities: z.array(integrationCapabilitySchema),
});
export type IntegrationProviderDto = z.infer<typeof integrationProviderDtoSchema>;

export const listIntegrationProvidersQuerySchema = z.object({
  capability: integrationCapabilitySchema.optional(),
});
export type ListIntegrationProvidersQueryDto = z.infer<typeof listIntegrationProvidersQuerySchema>;

export const listIntegrationProvidersResponseSchema = z.object({
  providers: z.array(integrationProviderDtoSchema),
});
export type ListIntegrationProvidersResponseDto = z.infer<
  typeof listIntegrationProvidersResponseSchema
>;

export const integrationConnectionDtoSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  provider: integrationProviderKindSchema,
  external_account_id: z.string(),
  slug: connectionSlugSchema,
  display_name: z.string(),
  lifecycle_status: integrationConnectionLifecycleStatusSchema,
  capabilities: z.array(integrationCapabilitySchema),
  external_url: z.string().url().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type IntegrationConnectionDto = z.infer<typeof integrationConnectionDtoSchema>;

export const listIntegrationConnectionsQuerySchema = z.object({
  workspace_id: z.string().uuid(),
  capability: integrationCapabilitySchema.optional(),
});
export type ListIntegrationConnectionsQueryDto = z.infer<
  typeof listIntegrationConnectionsQuerySchema
>;

export const listIntegrationConnectionsResponseSchema = z.object({
  connections: z.array(integrationConnectionDtoSchema),
});
export type ListIntegrationConnectionsResponseDto = z.infer<
  typeof listIntegrationConnectionsResponseSchema
>;

export const updateIntegrationConnectionBodySchema = z.object({
  lifecycle_status: updateIntegrationConnectionLifecycleStatusSchema,
});
export type UpdateIntegrationConnectionBodyDto = z.infer<
  typeof updateIntegrationConnectionBodySchema
>;

export const updateIntegrationConnectionRepositoryAccessBodySchema = z.object({
  mode: integrationConnectionRepositoryAccessModeSchema,
});
export type UpdateIntegrationConnectionRepositoryAccessBodyDto = z.infer<
  typeof updateIntegrationConnectionRepositoryAccessBodySchema
>;

export const integrationConnectionRepositoryAccessRepositorySchema = z.object({
  external_repository_id: z.string().min(1).max(255),
  owner: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  project_id: z.string().uuid(),
  project_name: z.string(),
  project_slug: z.string().min(1).max(255),
});
export type IntegrationConnectionRepositoryAccessRepositoryDto = z.infer<
  typeof integrationConnectionRepositoryAccessRepositorySchema
>;

export const listIntegrationConnectionRepositoryAccessQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type ListIntegrationConnectionRepositoryAccessQueryDto = z.infer<
  typeof listIntegrationConnectionRepositoryAccessQuerySchema
>;

export const integrationConnectionRepositoryAccessResponseSchema = z.object({
  mode: integrationConnectionRepositoryAccessModeSchema,
  repositories: z.array(integrationConnectionRepositoryAccessRepositorySchema),
  next_cursor: z.string().nullable(),
});
export type IntegrationConnectionRepositoryAccessResponseDto = z.infer<
  typeof integrationConnectionRepositoryAccessResponseSchema
>;

export const updateIntegrationConnectionRepositoryAccessResponseSchema = z.object({
  mode: integrationConnectionRepositoryAccessModeSchema,
});
export type UpdateIntegrationConnectionRepositoryAccessResponseDto = z.infer<
  typeof updateIntegrationConnectionRepositoryAccessResponseSchema
>;

export const listRepositoriesParamsSchema = z.object({
  connectionId: z.string().uuid(),
});
export type ListRepositoriesParamsDto = z.infer<typeof listRepositoriesParamsSchema>;

export const listRepositoriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  search: z.string().min(1).max(100).optional(),
});
export type ListRepositoriesQueryDto = z.infer<typeof listRepositoriesQuerySchema>;

export const repositoryDtoSchema = z.object({
  connection_id: z.string().uuid(),
  external_repository_id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  visibility: repositoryVisibilitySchema,
  clone_url: z.string(),
  html_url: z.string(),
});
export type RepositoryDto = z.infer<typeof repositoryDtoSchema>;

export const listRepositoriesResponseSchema = z.object({
  repositories: z.array(repositoryDtoSchema),
  next_cursor: z.string().nullable(),
});
export type ListRepositoriesResponseDto = z.infer<typeof listRepositoriesResponseSchema>;
