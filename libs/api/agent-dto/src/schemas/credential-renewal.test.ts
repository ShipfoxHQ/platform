import {z} from 'zod';
import {credentialRenewalSchema, validateRenewalWindow} from './index.js';

describe('credential renewal contracts', () => {
  it('exports a renewal schema and validator for refresh-at credentials', () => {
    const schema = z
      .object({
        expires_at: z.string().datetime({offset: true}),
        renewal: credentialRenewalSchema,
      })
      .superRefine(validateRenewalWindow);
    const input = {
      expires_at: '2026-06-10T12:00:00.000Z',
      renewal: {mode: 'refresh-at' as const, refresh_at: '2026-06-10T11:55:00.000Z'},
    };

    expect(schema.parse(input)).toEqual(input);
  });

  it('rejects a refresh-at renewal at or after expiry', () => {
    const schema = z
      .object({
        expires_at: z.string().datetime({offset: true}),
        renewal: credentialRenewalSchema,
      })
      .superRefine(validateRenewalWindow);

    expect(
      schema.safeParse({
        expires_at: '2026-06-10T12:00:00.000Z',
        renewal: {mode: 'refresh-at', refresh_at: '2026-06-10T12:00:00.000Z'},
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        expires_at: '2026-06-10T12:00:00.000Z',
        renewal: {mode: 'refresh-at', refresh_at: '2026-06-10T12:05:00.000Z'},
      }).success,
    ).toBe(false);
  });

  it('rejects impossible calendar dates instead of relying on Date.parse normalization', () => {
    const schema = z
      .object({
        expires_at: z.string().datetime({offset: true}),
        renewal: credentialRenewalSchema,
      })
      .superRefine(validateRenewalWindow);

    expect(
      schema.safeParse({
        expires_at: '2026-03-03T12:00:00.000Z',
        renewal: {mode: 'refresh-at', refresh_at: '2026-02-30T11:55:00.000Z'},
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        expires_at: '2026-02-30T12:00:00.000Z',
        renewal: {mode: 'refresh-at', refresh_at: '2026-02-28T11:55:00.000Z'},
      }).success,
    ).toBe(false);
  });
});
