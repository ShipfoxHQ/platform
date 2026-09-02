import {z} from 'zod';

const testVcsRepositoryPartSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u);

export const testVcsRenewalModeSchema = z.enum(['refresh-at', 'on-rejection']);
export type TestVcsRenewalModeDto = z.infer<typeof testVcsRenewalModeSchema>;

export const createE2eTestVcsConnectionBodySchema = z
  .object({
    workspace_id: z.string().uuid(),
    account_id: testVcsRepositoryPartSchema,
    display_name: z.string().min(1).max(200).optional(),
    renewal_mode: testVcsRenewalModeSchema.default('on-rejection'),
    refresh_after_seconds: z.number().positive().max(300).optional(),
  })
  .strict()
  .refine(
    (body) => body.refresh_after_seconds === undefined || body.renewal_mode === 'refresh-at',
    {
      message: 'refresh_after_seconds requires refresh-at renewal mode',
      path: ['refresh_after_seconds'],
    },
  );
export type CreateE2eTestVcsConnectionBodyDto = z.infer<
  typeof createE2eTestVcsConnectionBodySchema
>;

const testVcsInvalidationSchema = z
  .object({
    key: z.string().min(1),
    repository: z.string().min(1),
    generation: z.string().min(1),
  })
  .strict();

const testVcsRequestSchema = z
  .object({
    method: z.string(),
    path: z.string(),
    status: z.enum(['accepted', 'rejected']),
    generation: z.string().min(1).optional(),
  })
  .strict();

export const testVcsStatsDtoSchema = z
  .object({
    mint_count: z.number().int().nonnegative(),
    request_count: z.number().int().nonnegative(),
    accepted_request_count: z.number().int().nonnegative(),
    rejected_request_count: z.number().int().nonnegative(),
    generations: z.array(z.string().min(1)),
    invalidations: z.array(testVcsInvalidationSchema),
    requests: z.array(testVcsRequestSchema),
  })
  .strict();
export type TestVcsStatsDto = z.infer<typeof testVcsStatsDtoSchema>;
