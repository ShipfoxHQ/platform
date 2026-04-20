import {z} from 'zod';

const invitationEmailSchema = z.string().trim().toLowerCase().email().max(254);

export const invitationDtoSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  email: z.string().email(),
  expires_at: z.string(),
  accepted_at: z.string().nullable(),
  invited_by_user_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type InvitationDto = z.infer<typeof invitationDtoSchema>;

export const createInvitationBodySchema = z.object({
  email: invitationEmailSchema,
});

export type CreateInvitationBodyDto = z.infer<typeof createInvitationBodySchema>;

export const listInvitationsResponseSchema = z.object({
  invitations: z.array(invitationDtoSchema),
});

export type ListInvitationsResponseDto = z.infer<typeof listInvitationsResponseSchema>;

export const acceptInvitationBodySchema = z.object({
  token: z.string().min(1),
});

export type AcceptInvitationBodyDto = z.infer<typeof acceptInvitationBodySchema>;

export const acceptInvitationResponseSchema = z.object({
  membership: z.object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    workspace_id: z.string().uuid(),
  }),
  already_member: z.boolean(),
});

export type AcceptInvitationResponseDto = z.infer<typeof acceptInvitationResponseSchema>;
