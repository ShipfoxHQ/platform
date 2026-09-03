import {credentialRenewalSchema, validateRenewalWindow} from '@shipfox/api-agent-dto';
import {z} from 'zod';

const carryFields = {
  carry: z.enum(['header', 'userinfo']),
  host: z.string().min(1),
  persist: z.boolean(),
};

const checkoutGitAuthorSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
});

const checkoutTokenBasicAuthSchema = z
  .object({
    kind: z.literal('basic'),
    username: z.string().min(1),
    token: z.string().min(1),
    expires_at: z.string().datetime({offset: true}),
    generation: z.string().min(1).optional(),
    renewal: credentialRenewalSchema.optional(),
    ...carryFields,
  })
  .superRefine(validateRenewalWindow);

const checkoutTokenBearerAuthSchema = z
  .object({
    kind: z.literal('bearer'),
    token: z.string().min(1),
    expires_at: z.string().datetime({offset: true}),
    generation: z.string().min(1).optional(),
    renewal: credentialRenewalSchema.optional(),
    ...carryFields,
  })
  .superRefine(validateRenewalWindow);

export const checkoutTokenAuthSchema = z.discriminatedUnion('kind', [
  checkoutTokenBasicAuthSchema,
  checkoutTokenBearerAuthSchema,
]);

export type CheckoutTokenAuthDto = z.infer<typeof checkoutTokenAuthSchema>;

export const checkoutTokenParamsSchema = z.object({
  stepId: z.string().uuid(),
});

export type CheckoutTokenParamsDto = z.infer<typeof checkoutTokenParamsSchema>;

export const checkoutTokenQuerySchema = z.object({
  attempt: z.coerce.number().int().positive(),
});

export type CheckoutTokenQueryDto = z.infer<typeof checkoutTokenQuerySchema>;

export const checkoutTokenBodySchema = z
  .object({
    rejected_generation: z.string().min(1).optional(),
  })
  .strict();

export type CheckoutTokenBodyDto = z.infer<typeof checkoutTokenBodySchema>;

export const checkoutTokenResponseSchema = z.object({
  repository_url: z.string().min(1),
  ref: z.string().min(1),
  fetch_depth: z.number().int().nonnegative(),
  git_author: checkoutGitAuthorSchema.optional(),
  // Optional: credential-free providers (e.g. the debug source control) return a
  // public clone URL with no auth material, so the runner clones without a token.
  auth: checkoutTokenAuthSchema.optional(),
});

export type CheckoutTokenResponseDto = z.infer<typeof checkoutTokenResponseSchema>;
