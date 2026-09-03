import {z} from 'zod';

export const credentialRenewalSchema = z.discriminatedUnion('mode', [
  z.object({mode: z.literal('refresh-at'), refresh_at: z.string().datetime({offset: true})}),
  z.object({mode: z.literal('on-rejection')}),
]);

export type CredentialRenewalDto = z.infer<typeof credentialRenewalSchema>;

export function validateRenewalWindow<
  T extends {
    expires_at?: string | undefined;
    renewal?: CredentialRenewalDto | undefined;
  },
>(auth: T, ctx: z.RefinementCtx): void {
  if (auth.renewal?.mode !== 'refresh-at') return;

  const refreshAt = Date.parse(auth.renewal.refresh_at);
  const expiresAt = auth.expires_at === undefined ? Number.NaN : Date.parse(auth.expires_at);
  if (!Number.isFinite(refreshAt) || !Number.isFinite(expiresAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['renewal', 'refresh_at'],
      message: 'refresh_at and expires_at must be valid timestamps',
    });
  } else if (refreshAt >= expiresAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['renewal', 'refresh_at'],
      message: 'refresh_at must be earlier than expires_at',
    });
  }
}
