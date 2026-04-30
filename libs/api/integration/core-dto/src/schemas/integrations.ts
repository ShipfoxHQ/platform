import {z} from 'zod';

export const integrationProviderKindSchema = z.string().min(1);
export type IntegrationProviderKindDto = z.infer<typeof integrationProviderKindSchema>;

export const integrationCapabilitySchema = z.enum(['source_control']);
export type IntegrationCapabilityDto = z.infer<typeof integrationCapabilitySchema>;

export const integrationConnectionLifecycleStatusSchema = z.enum(['active', 'disabled', 'error']);
export type IntegrationConnectionLifecycleStatusDto = z.infer<
  typeof integrationConnectionLifecycleStatusSchema
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
  display_name: z.string(),
  lifecycle_status: integrationConnectionLifecycleStatusSchema,
  capabilities: z.array(integrationCapabilitySchema),
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

export const listRepositoriesParamsSchema = z.object({
  connectionId: z.string().uuid(),
});
export type ListRepositoriesParamsDto = z.infer<typeof listRepositoriesParamsSchema>;

export const listRepositoriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
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
