import {workspaceAdministrationMutationBodySchema} from './workspace.js';

const parseReason = (reason: string) =>
  workspaceAdministrationMutationBodySchema.safeParse({reason});

describe('workspaceAdministrationMutationBodySchema', () => {
  it.each(['', '   ', '\u00a0\u2003'])('rejects a %j reason', (reason) => {
    expect(parseReason(reason).success).toBe(false);
  });

  it('trims surrounding whitespace from a meaningful reason', () => {
    expect(parseReason('  Requested by the support operator  ')).toEqual({
      success: true,
      data: {reason: 'Requested by the support operator'},
    });
  });

  it('preserves ordinary internal whitespace', () => {
    expect(parseReason('Requested  by the support operator')).toEqual({
      success: true,
      data: {reason: 'Requested  by the support operator'},
    });
  });

  it('accepts 512 characters after surrounding whitespace is normalized', () => {
    const result = parseReason(`  ${'a'.repeat(512)}  `);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toHaveLength(512);
  });

  it('rejects more than 512 characters after surrounding whitespace is normalized', () => {
    expect(parseReason(`  ${'a'.repeat(513)}  `).success).toBe(false);
  });

  it.each([
    ['control', 'Reason\nwith control'],
    ['format', 'Reason\u202ewith format character'],
    ['zero-width', 'Reason\u200dwith format character'],
  ])('rejects %s characters', (_kind, reason) => {
    expect(() => workspaceAdministrationMutationBodySchema.parse({reason})).toThrow(
      'must not contain control or format characters',
    );
  });
});
