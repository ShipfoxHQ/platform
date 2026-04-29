import {z} from 'zod';
import {emailSchema, loginResponseSchema, passwordSchema} from './auth.js';
import {userDtoSchema} from './user.js';

export const e2eCreateUserBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  verified: z.boolean(),
  name: z.string().min(1).max(255).optional(),
});

export type E2eCreateUserBodyDto = z.infer<typeof e2eCreateUserBodySchema>;

export const e2eCreateUserResponseSchema = z.object({
  user: userDtoSchema,
  email: z.string().email(),
  password: passwordSchema,
});

export type E2eCreateUserResponseDto = z.infer<typeof e2eCreateUserResponseSchema>;

export const e2eCreateSessionBodySchema = z
  .object({
    user_id: z.string().uuid().optional(),
    email: emailSchema.optional(),
  })
  .refine((value) => Boolean(value.user_id || value.email), {
    message: 'Either user_id or email is required',
  });

export type E2eCreateSessionBodyDto = z.infer<typeof e2eCreateSessionBodySchema>;

export const e2eCreateSessionResponseSchema = loginResponseSchema;

export type E2eCreateSessionResponseDto = z.infer<typeof e2eCreateSessionResponseSchema>;

export type E2eSessionDto = E2eCreateSessionResponseDto & {
  setCookie: string;
};
