import {displayNameSchema, emailSchema} from '@shipfox/api-common-dto';
import {z} from 'zod';
import {adminRoleSchema} from './admin.js';
import {userDtoSchema} from './user.js';

export const passwordSchema = z.string().min(12).max(128);
export {emailSchema};

export const loginMethodSchema = z.object({
  id: z.string().min(1).max(128),
});

export type LoginMethodDto = z.infer<typeof loginMethodSchema>;

export const loginMethodsResponseSchema = z.object({
  login_methods: z.array(loginMethodSchema),
});

export type LoginMethodsResponseDto = z.infer<typeof loginMethodsResponseSchema>;

export const signupBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: displayNameSchema,
  invitation_token: z.string().min(1).max(256).optional(),
});

export type SignupBodyDto = z.infer<typeof signupBodySchema>;

export const signupAcceptErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export type SignupAcceptErrorDto = z.infer<typeof signupAcceptErrorSchema>;

export const signupMembershipSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
});

export type SignupMembershipDto = z.infer<typeof signupMembershipSchema>;

export const signupResponseSchema = z.object({
  user: userDtoSchema,
  email_challenge: z
    .object({
      id: z.string().uuid(),
      next_resend_available_at: z.string().datetime(),
    })
    .optional(),
  token: z.string().optional(),
  membership: signupMembershipSchema.nullable().optional(),
  accept_error: signupAcceptErrorSchema.optional(),
});

export type SignupResponseDto = z.infer<typeof signupResponseSchema>;

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export type LoginBodyDto = z.infer<typeof loginBodySchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  user: userDtoSchema,
  admin_role: adminRoleSchema.nullable().optional(),
});

export type LoginResponseDto = z.infer<typeof loginResponseSchema>;

/**
 * A session response for an externally minted (adopted) session, which may
 * carry the optional impersonation mark. The cookie-based login and refresh
 * responses never set it. ADR 0014 mint, replay, and renewal responses use
 * this shape; the route that emits it is not implemented yet.
 */
export const sessionResponseSchema = loginResponseSchema.extend({
  impersonator_id: z.string().uuid().optional(),
});

export type SessionResponseDto = z.infer<typeof sessionResponseSchema>;

export const refreshResponseSchema = loginResponseSchema;

export type RefreshResponseDto = z.infer<typeof refreshResponseSchema>;

export const meResponseSchema = z.object({
  user: userDtoSchema,
  admin_role: adminRoleSchema.nullable().optional(),
  impersonator_id: z.string().uuid().optional(),
});

export type MeResponseDto = z.infer<typeof meResponseSchema>;

export const logoutBodySchema = z.object({});

export type LogoutBodyDto = z.infer<typeof logoutBodySchema>;

export const changePasswordBodySchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: passwordSchema,
});

export type ChangePasswordBodyDto = z.infer<typeof changePasswordBodySchema>;

export const passwordResetRequestBodySchema = z.object({
  email: emailSchema,
});

export type PasswordResetRequestBodyDto = z.infer<typeof passwordResetRequestBodySchema>;

export const passwordResetConfirmBodySchema = z.object({
  token: z.string().min(1),
  new_password: passwordSchema,
});

export type PasswordResetConfirmBodyDto = z.infer<typeof passwordResetConfirmBodySchema>;

export const passwordResetConfirmResponseSchema = loginResponseSchema;

export type PasswordResetConfirmResponseDto = z.infer<typeof passwordResetConfirmResponseSchema>;

export const verifyEmailConfirmBodySchema = z.object({
  email: emailSchema,
  challenge_id: z.string().uuid(),
  code: z.string().regex(/^\d{8}$/u),
});

export type VerifyEmailConfirmBodyDto = z.infer<typeof verifyEmailConfirmBodySchema>;

export const verifyEmailConfirmResponseSchema = loginResponseSchema;

export type VerifyEmailConfirmResponseDto = z.infer<typeof verifyEmailConfirmResponseSchema>;

export const verifyEmailResendBodySchema = z.object({
  email: emailSchema,
  challenge_id: z.string().uuid(),
});

export type VerifyEmailResendBodyDto = z.infer<typeof verifyEmailResendBodySchema>;

export const verifyEmailResendResponseSchema = z.object({
  next_resend_available_at: z.string().datetime(),
});

export type VerifyEmailResendResponseDto = z.infer<typeof verifyEmailResendResponseSchema>;
