import {z} from 'zod';

export const projectSourceDtoSchema = z.object({
  connection_id: z.string().uuid(),
  external_repository_id: z.string(),
});
export type ProjectSourceDto = z.infer<typeof projectSourceDtoSchema>;

export const createProjectBodySchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  source: z.object({
    connection_id: z.string().uuid(),
    external_repository_id: z.string().min(1).max(255),
  }),
});

export type CreateProjectBodyDto = z.infer<typeof createProjectBodySchema>;

export const projectDtoSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string(),
  source: projectSourceDtoSchema,
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
