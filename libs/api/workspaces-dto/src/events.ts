import {z} from 'zod';
import {workspaceRoleSchema} from './schemas/membership.js';

export const WORKSPACES_INVITATION_SEND_REQUESTED = 'workspaces.invitation.send_requested' as const;
export const WORKSPACES_WORKSPACE_CREATED = 'workspaces.workspace.created' as const;
export const WORKSPACES_WORKSPACE_UPDATED = 'workspaces.workspace.updated' as const;
export const WORKSPACES_MEMBER_INVITED = 'workspaces.member.invited' as const;
export const WORKSPACES_MEMBER_JOINED = 'workspaces.member.joined' as const;

export const workspacesInvitationSendRequestedSchema = z.object({
  email: z.string().email(),
  workspaceName: z.string(),
  inviterName: z.string(),
  inviteLink: z.string().url(),
});
export type WorkspacesInvitationSendRequestedEvent = z.infer<
  typeof workspacesInvitationSendRequestedSchema
>;

export const workspaceCreatedEventSchema = z.object({
  workspaceId: z.string().nonempty(),
  name: z.string().nonempty(),
  // Existing outbox rows may predate workspace slugs.
  slug: z.string().nonempty().optional(),
  creatorUserId: z.string().nonempty(),
});
export type WorkspaceCreatedEvent = z.infer<typeof workspaceCreatedEventSchema>;

export const workspaceUpdatedEventSchema = z.object({
  workspaceId: z.string().nonempty(),
  name: z.string().nonempty(),
  slug: z.string().nonempty(),
});
export type WorkspaceUpdatedEvent = z.infer<typeof workspaceUpdatedEventSchema>;

export const workspacesMemberInvitedSchema = z.object({
  workspaceId: z.string().uuid(),
  invitedEmail: z.string().email(),
  inviterUserId: z.string().uuid(),
  role: workspaceRoleSchema,
});
export type WorkspacesMemberInvitedEvent = z.infer<typeof workspacesMemberInvitedSchema>;

export const workspacesMemberJoinedSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  email: z.string().email(),
  viaInvitation: z.boolean(),
});
export type WorkspacesMemberJoinedEvent = z.infer<typeof workspacesMemberJoinedSchema>;

export interface WorkspacesEventMap {
  [WORKSPACES_INVITATION_SEND_REQUESTED]: WorkspacesInvitationSendRequestedEvent;
  [WORKSPACES_WORKSPACE_CREATED]: WorkspaceCreatedEvent;
  [WORKSPACES_WORKSPACE_UPDATED]: WorkspaceUpdatedEvent;
  [WORKSPACES_MEMBER_INVITED]: WorkspacesMemberInvitedEvent;
  [WORKSPACES_MEMBER_JOINED]: WorkspacesMemberJoinedEvent;
}

export const workspacesEventSchemas = {
  [WORKSPACES_INVITATION_SEND_REQUESTED]: workspacesInvitationSendRequestedSchema,
  [WORKSPACES_WORKSPACE_CREATED]: workspaceCreatedEventSchema,
  [WORKSPACES_WORKSPACE_UPDATED]: workspaceUpdatedEventSchema,
  [WORKSPACES_MEMBER_INVITED]: workspacesMemberInvitedSchema,
  [WORKSPACES_MEMBER_JOINED]: workspacesMemberJoinedSchema,
} satisfies Record<keyof WorkspacesEventMap, z.ZodType>;
