import {
  integrationConnectionDtoSchema,
  updateIntegrationConnectionLifecycleStatusSchema,
} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const createGithubInstallBodySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type CreateGithubInstallBodyDto = z.infer<typeof createGithubInstallBodySchema>;

export const createGithubInstallResponseSchema = z.object({
  install_url: z.string().url(),
});
export type CreateGithubInstallResponseDto = z.infer<typeof createGithubInstallResponseSchema>;

export const githubCallbackQuerySchema = z.object({
  code: z.string().min(1),
  installation_id: z.coerce.number().int().positive(),
  state: z.string().min(1),
  setup_action: z.string().optional(),
});
export type GithubCallbackQueryDto = z.infer<typeof githubCallbackQuerySchema>;

export const githubCallbackResponseSchema = integrationConnectionDtoSchema;
export type GithubCallbackResponseDto = z.infer<typeof githubCallbackResponseSchema>;

export const createE2eGithubConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  installation_id: z.number().int().positive(),
  account_login: z.string().min(1),
  display_name: z.string().min(1),
  installer_user_id: z.string().uuid(),
  lifecycle_status: updateIntegrationConnectionLifecycleStatusSchema.optional(),
});
export type CreateE2eGithubConnectionBodyDto = z.infer<typeof createE2eGithubConnectionBodySchema>;

export const createE2eGithubConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateE2eGithubConnectionResponseDto = z.infer<
  typeof createE2eGithubConnectionResponseSchema
>;
