import {displayNameSchema, slugSchema} from '@shipfox/api-common-dto';
import {z} from 'zod';
import {invitationDtoSchema} from './invitation.js';
import {workspaceResponseSchema} from './workspace.js';

export const e2eCreateWorkspaceBodySchema = z.object({
  user_id: z.string().uuid(),
  user_email: z.string().email().optional(),
  user_name: z.string().nullable().optional(),
  name: displayNameSchema,
  slug: slugSchema.optional(),
});

export type E2eCreateWorkspaceBodyDto = z.infer<typeof e2eCreateWorkspaceBodySchema>;

export const e2eCreateWorkspaceResponseSchema = workspaceResponseSchema;

export type E2eCreateWorkspaceResponseDto = z.infer<typeof e2eCreateWorkspaceResponseSchema>;

export const e2eCreateInvitationBodySchema = z.object({
  workspace_id: z.string().uuid(),
  email: z.string().email(),
  invited_by_user_id: z.string().uuid(),
  invited_by_display: z.string().nullable().optional(),
});

export type E2eCreateInvitationBodyDto = z.infer<typeof e2eCreateInvitationBodySchema>;

export const e2eCreateInvitationResponseSchema = z.object({
  invitation: invitationDtoSchema,
  raw_token: z.string().min(1),
});

export type E2eCreateInvitationResponseDto = z.infer<typeof e2eCreateInvitationResponseSchema>;
