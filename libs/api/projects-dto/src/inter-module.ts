import {slugSchema} from '@shipfox/api-common-dto';
import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';

const idSchema = z.string().uuid();
const projectSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  sourceConnectionId: idSchema,
  sourceExternalRepositoryId: z.string(),
  sourceRepositoryOwner: z.string().min(1).nullable().optional(),
  sourceRepositoryName: z.string().min(1).nullable().optional(),
  sourceDefaultBranch: z.string().min(1).nullable().optional(),
  name: z.string(),
});
const projectCatalogSchema = projectSchema.extend({
  slug: slugSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const workspaceProjectCountSchema = z.object({
  workspaceId: idSchema,
  count: z.number().int().nonnegative(),
});
const projectCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: idSchema,
});
const projectRepositorySchema = z.object({
  externalRepositoryId: z.string(),
  owner: z.string().min(1),
  name: z.string().min(1),
  projectId: idSchema,
  projectName: z.string(),
  projectSlug: slugSchema,
});
const projectRepositoryCursorSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  externalRepositoryId: z.string(),
});
const checkoutTargetSchema = z.strictObject({project: idSchema});
const resolvedCheckoutTargetValue = z.strictObject({
  kind: z.literal('external-id'),
  externalRepositoryId: z.string(),
});
const resolvedCheckoutTargetSchema = z.object({
  projectId: idSchema,
  connectionId: idSchema,
  target: resolvedCheckoutTargetValue,
});

/** Producer-owned project lookup and workspace ownership operations. */
export const projectsInterModuleContract = defineInterModuleContract({
  module: 'projects',
  methods: {
    getProjectById: {
      input: z.object({projectId: idSchema}),
      output: z.object({project: projectSchema.nullable()}),
    },
    getProjectBySource: {
      input: z.object({
        workspaceId: idSchema,
        sourceConnectionId: idSchema,
        sourceExternalRepositoryId: z.string(),
      }),
      output: z.object({project: projectSchema.nullable()}),
    },
    findProjectBySourceRepositoryName: {
      input: z.object({
        workspaceId: idSchema,
        sourceConnectionId: idSchema,
        sourceRepositoryOwner: z.string().min(1),
        sourceRepositoryName: z.string().min(1),
      }),
      output: z.object({projects: z.array(projectSchema)}),
    },
    /**
     * Results use an exclusive keyset cursor over lower(owner), lower(name),
     * and externalRepositoryId. Consumers composing this page with another
     * source must preserve that same folded owner/name ordering.
     */
    listProjectsBySourceConnection: {
      input: z.object({
        workspaceId: idSchema,
        sourceConnectionId: idSchema,
        limit: z.number().int().min(1).max(100),
        cursor: projectRepositoryCursorSchema.optional(),
      }),
      output: z.object({
        projects: z.array(projectRepositorySchema),
        nextCursor: projectRepositoryCursorSchema.nullable(),
      }),
    },
    listProjectsByWorkspace: {
      input: z.object({
        workspaceId: idSchema,
        limit: z.number().int().min(1).max(100),
        cursor: projectCursorSchema.optional(),
      }),
      output: z.object({
        projects: z.array(projectSchema),
        nextCursor: projectCursorSchema.nullable(),
      }),
    },
    listProjectCatalogByWorkspace: {
      input: z.object({
        workspaceId: idSchema,
        limit: z.number().int().min(1).max(100),
        cursor: projectCursorSchema.optional(),
      }),
      output: z.object({
        projects: z.array(projectCatalogSchema),
        nextCursor: projectCursorSchema.nullable(),
      }),
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
    resolveCheckoutTarget: {
      input: z.object({
        workspaceId: idSchema,
        target: checkoutTargetSchema,
      }),
      output: resolvedCheckoutTargetSchema,
      errors: {
        'checkout-repository-not-authorized': z.object({}),
      },
    },
  },
});

export type ProjectsModuleClient = InterModuleClient<typeof projectsInterModuleContract>;
