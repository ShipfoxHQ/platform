import {z} from 'zod';
import {userDtoSchema} from './user.js';

export const passwordSchema = z.string().min(12).max(128);
export const emailSchema = z
  .string()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

export const signupBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(255).optional(),
});

export type SignupBodyDto = z.infer<typeof signupBodySchema>;

export const signupResponseSchema = z.object({
  user: userDtoSchema,
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
});

export type LoginResponseDto = z.infer<typeof loginResponseSchema>;

export const refreshResponseSchema = loginResponseSchema;

export type RefreshResponseDto = z.infer<typeof refreshResponseSchema>;

export const meResponseSchema = z.object({
  user: userDtoSchema,
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
  token: z.string().min(1),
});

export type VerifyEmailConfirmBodyDto = z.infer<typeof verifyEmailConfirmBodySchema>;

export const verifyEmailConfirmResponseSchema = loginResponseSchema;

export type VerifyEmailConfirmResponseDto = z.infer<typeof verifyEmailConfirmResponseSchema>;

export const verifyEmailResendBodySchema = z.object({
  email: emailSchema,
});

export type VerifyEmailResendBodyDto = z.infer<typeof verifyEmailResendBodySchema>;
