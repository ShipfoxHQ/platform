import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {buildPageMetadata} from './lib/page-metadata';
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

  it('uses the public docs origin when the production host is a Vercel deployment', () => {
    assert.equal(
      resolveDocsOrigin({
        VERCEL_ENV: 'production',
        NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: 'shipfox-docs-git-main.vercel.app',
      }),
      PUBLIC_DOCS_ORIGIN,
    );
  });

  it('uses the configured Vercel production host when available', () => {
    assert.equal(
      resolveDocsOrigin({
        VERCEL_ENV: 'production',
        NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: 'docs-route-check.shipfox.test',
      }),
      'https://docs-route-check.shipfox.test',
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
    assert.equal(toMarkdownUrl('/'), toUrl('/index.md'));
  });

  it('adds the Markdown suffix to page-specific alternates', () => {
    assert.equal(toMarkdownUrl('/getting-started'), `${toUrl('/getting-started')}.md`);
  });

  it('builds canonical and Markdown URLs with the production path prefix', () => {
    const productionOrigin = resolveDocsOrigin({
      VERCEL_ENV: 'production',
      VERCEL_URL: 'shipfox-docs-git-main.vercel.app',
    });

    assert.equal(toUrl('/', productionOrigin, '/docs'), `${PUBLIC_DOCS_ORIGIN}/docs`);
    assert.equal(
      toMarkdownUrl('/', productionOrigin, '/docs'),
      `${PUBLIC_DOCS_ORIGIN}/docs/index.md`,
    );
    assert.equal(
      toUrl('/getting-started', productionOrigin, '/docs'),
      `${PUBLIC_DOCS_ORIGIN}/docs/getting-started`,
    );
    assert.equal(
      toMarkdownUrl('/getting-started', productionOrigin, '/docs'),
      `${PUBLIC_DOCS_ORIGIN}/docs/getting-started.md`,
    );
  });

  it('uses canonical and Markdown alternates in home and nested page metadata', () => {
    const homeMetadata = buildPageMetadata(
      {url: '/', data: {title: 'Shipfox', description: 'Home page'}},
      PUBLIC_DOCS_ORIGIN,
      '/docs',
    );
    const nestedMetadata = buildPageMetadata(
      {url: '/getting-started', data: {title: 'Getting started', description: 'First steps'}},
      PUBLIC_DOCS_ORIGIN,
      '/docs',
    );

    assert.equal(homeMetadata.alternates?.canonical, `${PUBLIC_DOCS_ORIGIN}/docs`);
    assert.equal(
      homeMetadata.alternates?.types?.['text/markdown'],
      `${PUBLIC_DOCS_ORIGIN}/docs/index.md`,
    );
    assert.equal(
      nestedMetadata.alternates?.canonical,
      `${PUBLIC_DOCS_ORIGIN}/docs/getting-started`,
    );
    assert.equal(
      nestedMetadata.alternates?.types?.['text/markdown'],
      `${PUBLIC_DOCS_ORIGIN}/docs/getting-started.md`,
    );
    assert.equal(nestedMetadata.openGraph?.url, `${PUBLIC_DOCS_ORIGIN}/docs/getting-started`);
  });
});
