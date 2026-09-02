import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {PUBLIC_DOCS_ORIGIN, resolveDocsOrigin, toMarkdownUrl, toUrl} from './url';

describe('resolveDocsOrigin', () => {
  it('uses the public docs origin for production builds', () => {
    assert.equal(
      resolveDocsOrigin({
        VERCEL_ENV: 'production',
        VERCEL_URL: 'shipfox-docs-git-main.vercel.app',
      }),
      PUBLIC_DOCS_ORIGIN,
    );
  });

  it('uses the deployment host for preview builds', () => {
    assert.equal(
      resolveDocsOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'shipfox-docs-git-feature.vercel.app',
      }),
      'https://shipfox-docs-git-feature.vercel.app',
    );
  });

  it('falls back to the local docs origin', () => {
    assert.equal(resolveDocsOrigin({}), 'http://localhost:3500');
  });
});

describe('docs URLs', () => {
  it('uses index.md for the docs home Markdown alternate', () => {
    assert.equal(toMarkdownUrl('/'), `${toUrl('/')}index.md`);
  });

  it('adds the Markdown suffix to page-specific alternates', () => {
    assert.equal(toMarkdownUrl('/getting-started'), `${toUrl('/getting-started')}.md`);
  });
});
