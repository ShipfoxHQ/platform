import {z} from 'zod';

export const giteaWebhookEventNames = ['push'] as const;

export const giteaPushPayloadSchema = z.object({
  ref: z.string().min(1),
  after: z.string().min(1),
  repository: z.object({
    name: z.string().min(1),
    full_name: z.string().min(1),
    default_branch: z.string().min(1),
    owner: z.object({username: z.string().min(1)}),
  }),
});
export type GiteaPushPayloadDto = z.infer<typeof giteaPushPayloadSchema>;
