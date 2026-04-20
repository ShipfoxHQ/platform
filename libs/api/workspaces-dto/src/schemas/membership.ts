import {z} from 'zod';

export const membershipDtoSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type MembershipDto = z.infer<typeof membershipDtoSchema>;

export const membershipWithWorkspaceSchema = membershipDtoSchema.extend({
  workspace_name: z.string(),
});

export type MembershipWithWorkspaceDto = z.infer<typeof membershipWithWorkspaceSchema>;

export const membershipWithUserSchema = membershipDtoSchema.extend({
  user_email: z.string().email(),
  user_name: z.string().nullable(),
});

export type MembershipWithUserDto = z.infer<typeof membershipWithUserSchema>;

export const listMembersResponseSchema = z.object({
  members: z.array(membershipWithUserSchema),
});

export type ListMembersResponseDto = z.infer<typeof listMembersResponseSchema>;

export const listUserWorkspacesResponseSchema = z.object({
  memberships: z.array(membershipWithWorkspaceSchema),
});

export type ListUserWorkspacesResponseDto = z.infer<typeof listUserWorkspacesResponseSchema>;
