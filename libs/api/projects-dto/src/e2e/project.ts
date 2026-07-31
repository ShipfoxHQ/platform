import {displayNameSchema, slugSchema} from '@shipfox/api-common-dto';
import {z} from 'zod';
import {projectResponseSchema} from '../schemas/project.js';

export const e2eCreateProjectBodySchema = z.object({
  workspace_id: z.string().uuid(),
  name: displayNameSchema,
  slug: slugSchema.optional(),
  source_connection_id: z.string().uuid().optional(),
  source_external_repository_id: z.string().min(1).max(255).optional(),
});

export type E2eCreateProjectBodyDto = z.infer<typeof e2eCreateProjectBodySchema>;

export const e2eCreateProjectResponseSchema = projectResponseSchema;

export type E2eCreateProjectResponseDto = z.infer<typeof e2eCreateProjectResponseSchema>;
