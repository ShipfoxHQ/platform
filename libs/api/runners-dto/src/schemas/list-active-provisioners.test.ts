import {
  installationRunnersStatusSchema,
  listActiveProvisionersResponseSchema,
} from './list-active-provisioners.js';

describe('list active provisioners schemas', () => {
  it('accepts an installation_runners status of managed', () => {
    expect(installationRunnersStatusSchema.parse('managed')).toBe('managed');
  });

  it('accepts an installation_runners status of none', () => {
    expect(installationRunnersStatusSchema.parse('none')).toBe('none');
  });

  it('rejects any other installation_runners status', () => {
    const result = installationRunnersStatusSchema.safeParse('unknown');

    expect(result.success).toBe(false);
  });

  it('parses a response with provisioners and installation_runners', () => {
    const response = {
      provisioners: [
        {
          id: crypto.randomUUID(),
          name: 'Docker provisioner',
          prefix: 'sf_pt_abcde',
          last_seen_at: '2026-05-08T01:00:00.000Z',
        },
      ],
      installation_runners: 'managed',
    };

    expect(listActiveProvisionersResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects a response without installation_runners', () => {
    const result = listActiveProvisionersResponseSchema.safeParse({
      provisioners: [],
    });

    expect(result.success).toBe(false);
  });
});
