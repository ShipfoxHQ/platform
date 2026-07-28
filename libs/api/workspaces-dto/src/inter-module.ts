import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {workspaceRoleSchema} from '#schemas/membership.js';
import {workspaceStatusSchema} from '#schemas/workspace.js';

const idSchema = z.string().uuid();

export const workspacesInterModuleContract = defineInterModuleContract({
  module: 'workspaces',
  methods: {
    listMembershipsForTokenClaims: {
      input: z.object({userId: idSchema}),
      output: z.object({
        memberships: z.array(
          z.object({
            workspaceId: idSchema,
            role: workspaceRoleSchema,
            workspaceStatus: workspaceStatusSchema.default('active'),
          }),
        ),
      }),
    },
    /** Resolves the user id that created the workspace, or null when no creator was recorded. */
    getWorkspaceCreator: {
      input: z.object({workspaceId: idSchema}),
      output: z.object({creatorUserId: idSchema.nullable()}),
      errors: {
        'workspace-not-found': z.object({workspaceId: idSchema}),
      },
    },
    /** Returns only the current workspace operating state needed by admission owners. */
    getWorkspaceOperatingState: {
      input: z.object({workspaceId: idSchema}),
      output: z.object({status: workspaceStatusSchema}),
      errors: {
        'workspace-not-found': z.object({workspaceId: idSchema}),
      },
    },
    preflightInvitationAcceptance: {
      input: z.object({token: z.string().min(1), email: z.string().email()}),
      output: z.object({}),
      errors: {
        'invitation-token-invalid': z.object({}),
        'invitation-token-used': z.object({}),
        'invitation-token-expired': z.object({}),
        'invitation-email-mismatch': z.object({}),
      },
    },
    acceptInvitation: {
      input: z.object({
        token: z.string().min(1),
        userId: idSchema,
        email: z.string().email(),
        name: z.string().nullable().optional(),
      }),
      output: z.object({
        membership: z.object({id: idSchema, userId: idSchema, workspaceId: idSchema}),
      }),
      errors: {
        'invitation-token-invalid': z.object({}),
        'invitation-token-used': z.object({}),
        'invitation-token-expired': z.object({}),
        'invitation-email-mismatch': z.object({}),
      },
    },
    requireActiveMembership: {
      input: z.object({
        workspaceId: idSchema,
        userId: idSchema,
        memberships: z.array(
          z.object({
            workspaceId: idSchema,
            role: workspaceRoleSchema,
            workspaceStatus: workspaceStatusSchema.default('active'),
          }),
        ),
      }),
      output: z.object({}),
      errors: {
        'membership-required': z.object({workspaceId: idSchema}),
        'workspace-not-found': z.object({workspaceId: idSchema}),
        'workspace-inactive': z.object({workspaceId: idSchema}),
      },
    },
  },
});

export type WorkspacesInterModuleClient = InterModuleClient<typeof workspacesInterModuleContract>;
