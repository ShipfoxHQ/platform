import {describe, expect, it} from '@shipfox/vitest/vitest';
import {parsePreviewIdentity} from '#introduction.js';

describe('preview identity parsing', () => {
  it('accepts main and pull request identities', () => {
    expect(parsePreviewIdentity({commitSha: 'main-sha', pullRequest: null})).toEqual({
      commitSha: 'main-sha',
      pullRequest: null,
    });
    expect(
      parsePreviewIdentity({
        commitSha: 'preview-sha',
        pullRequest: {number: 42, url: 'https://github.com/ShipfoxHQ/shipfox/pull/42'},
      }),
    ).toEqual({
      commitSha: 'preview-sha',
      pullRequest: {
        number: 42,
        url: 'https://github.com/ShipfoxHQ/shipfox/pull/42',
      },
    });
  });

  it.each([
    null,
    {},
    {commitSha: ''},
    {commitSha: 'preview-sha', pullRequest: '42'},
    {commitSha: 'preview-sha', pullRequest: {number: 0}},
    {commitSha: 'preview-sha', pullRequest: {number: 42.5}},
  ])('rejects invalid identity metadata %#', (metadata) => {
    expect(parsePreviewIdentity(metadata)).toBeNull();
  });
});
