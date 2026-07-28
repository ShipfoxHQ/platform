import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';

const idSchema = z.string().uuid();
const projectSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  sourceConnectionId: idSchema,
  sourceExternalRepositoryId: z.string(),
  name: z.string(),
});
const workspaceProjectCountSchema = z.object({
  workspaceId: idSchema,
  count: z.number().int().nonnegative(),
});

/** Producer-owned project lookup and workspace ownership operations. */
export const projectsInterModuleContract = defineInterModuleContract({
  module: 'projects',
  methods: {
    getProjectById: {
      input: z.object({projectId: idSchema}),
      output: z.object({project: projectSchema.nullable()}),
    },
    requireProjectForWorkspace: {
      input: z.object({projectId: idSchema, workspaceId: idSchema}),
      output: z.object({project: projectSchema}),
      errors: {
        'project-not-found': z.object({projectId: idSchema}),
        'project-workspace-mismatch': z.object({projectId: idSchema, workspaceId: idSchema}),
      },
    },
    getWorkspaceProjectCounts: {
      input: z.object({workspaceIds: z.array(idSchema).min(1).max(100)}),
      output: z.object({counts: z.array(workspaceProjectCountSchema)}),
    },
  },
});

export type ProjectsModuleClient = InterModuleClient<typeof projectsInterModuleContract>;
