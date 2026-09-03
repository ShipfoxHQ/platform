import {z} from 'zod';

const isoCalendarDatePrefix = /^(\d{4})-(\d{2})-(\d{2})T/;

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
  if (
    !hasValidCalendarDate(auth.renewal.refresh_at) ||
    auth.expires_at === undefined ||
    !hasValidCalendarDate(auth.expires_at) ||
    !Number.isFinite(refreshAt) ||
    !Number.isFinite(expiresAt)
  ) {
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

function hasValidCalendarDate(value: string): boolean {
  const match = isoCalendarDatePrefix.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  return daysInMonth !== undefined && day <= daysInMonth;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
