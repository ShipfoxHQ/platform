import {z} from 'zod';

export const userStatusSchema = z.enum(['active', 'suspended', 'deleted']);

export const userDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  email_verified_at: z.string().nullable(),
  status: userStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserDto = z.infer<typeof userDtoSchema>;
