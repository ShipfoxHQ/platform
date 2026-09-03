import {displayNameSchema, slugSchema} from '@shipfox/api-common-dto';
import {z} from 'zod';
import {projectResponseSchema} from '../schemas/project.js';

export const e2eCreateProjectBodySchema = z
  .object({
    workspace_id: z.string().uuid(),
    name: displayNameSchema,
    slug: slugSchema.optional(),
    source_connection_id: z.string().uuid().optional(),
    source_external_repository_id: z.string().min(1).max(255).optional(),
    // Test-only source metadata lets E2E fixtures exercise project-backed repository views
    // without calling a real provider during setup.
    source_repository_owner: z.string().min(1).max(255).optional(),
    source_repository_name: z.string().min(1).max(255).optional(),
    source_default_branch: z.string().min(1).max(255).optional(),
  })
  .superRefine((body, context) => {
    const hasOwner = body.source_repository_owner !== undefined;
    const hasName = body.source_repository_name !== undefined;
    if (hasOwner !== hasName) {
      context.addIssue({
        code: 'custom',
        path: ['source_repository_owner'],
        message: 'Source repository owner and name must be provided together',
      });
    }
  });

export type E2eCreateProjectBodyDto = z.infer<typeof e2eCreateProjectBodySchema>;

export const e2eCreateProjectResponseSchema = projectResponseSchema;

export type E2eCreateProjectResponseDto = z.infer<typeof e2eCreateProjectResponseSchema>;
