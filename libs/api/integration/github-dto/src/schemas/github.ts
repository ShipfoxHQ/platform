import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
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
