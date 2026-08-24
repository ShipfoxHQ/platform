import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  checkRepositoryDocumentation,
  collectDocumentationFiles,
  extractMarkdownLinks,
} from '../src/repository-documentation.js';

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repository-documentation-policy-'));
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      const filePath = path.join(root, file);
      await mkdir(path.dirname(filePath), {recursive: true});
      await writeFile(filePath, content);
    }),
  );
  return root;
}

describe('repository documentation policy', () => {
  test('extracts links with line numbers and ignores fenced examples', () => {
    assert.deepEqual(
      extractMarkdownLinks(
        '# Guide\n\nRead [the map](docs/README.md).\n\n```md\n[example](missing.md)\n```',
      ),
      [{line: 3, target: 'docs/README.md'}],
    );
  });

  test('accepts local README roots and ADRs reachable through their index', async () => {
    const root = await fixture({
      'README.md': '[Guide](docs/guides/guide.md#guide)\n[Package](libs/example/README.md)',
      'docs/README.md': '[ADR index](adr/README.md)',
      'docs/adr/README.md': '[ADR](0001-example.md)',
      'docs/adr/0001-example.md': '# Example decision',
      'docs/guides/guide.md': '# Guide',
      'libs/example/README.md': '# Package',
    });
    try {
      const result = await checkRepositoryDocumentation(root);
      assert.deepEqual(result.violations, []);
    } finally {
      await rm(root, {recursive: true});
    }
  });

  test('reports a broken link and missing anchor with source locations', async () => {
    const root = await fixture({
      'README.md': '[Missing](docs/missing.md)\n[Guide](docs/guide.md#unknown)',
      'docs/guide.md': '# Guide',
    });
    try {
      const result = await checkRepositoryDocumentation(root);
      assert.deepEqual(result.violations, [
        {
          kind: 'broken-link',
          source: 'README.md',
          line: 1,
          target: 'docs/missing.md',
          reason: 'target does not exist',
        },
        {
          kind: 'missing-anchor',
          source: 'README.md',
          line: 2,
          target: 'docs/guide.md#unknown',
          reason: 'target heading does not exist',
        },
      ]);
    } finally {
      await rm(root, {recursive: true});
    }
  });

  test('reports an orphan with a remediation hint', async () => {
    const root = await fixture({
      'README.md': '# Repository',
      'docs/README.md': '# Map',
      'docs/guides/orphan.md': '# Orphan',
    });
    try {
      const result = await checkRepositoryDocumentation(root);
      assert.deepEqual(result.violations, [
        {
          kind: 'orphan',
          file: 'docs/guides/orphan.md',
          reason:
            'No approved entrypoint or documentation index links to this file. Add a contextual link from docs/README.md or the owning subsystem index.',
        },
      ]);
    } finally {
      await rm(root, {recursive: true});
    }
  });

  test('keeps separately owned documentation outside this check', async () => {
    const root = await fixture({
      'README.md': '# Repository',
      '.agents/skills/example/SKILL.md': '[missing](nowhere.md)',
      '.claude/skills/example/SKILL.md': '[missing](nowhere.md)',
      'apps/docs/content/docs/page.mdx': '[missing](nowhere.mdx)',
      'apps/docs/WRITING.md': '[missing](nowhere.md)',
      '.github/skills/example/SKILL.md': '[missing](nowhere.md)',
      'libs/example/CHANGELOG.md': '[missing](nowhere.md)',
      '.changeset/example.md': '[missing](nowhere.md)',
    });
    try {
      assert.deepEqual(await collectDocumentationFiles(root), ['README.md']);
      assert.deepEqual((await checkRepositoryDocumentation(root)).violations, []);
    } finally {
      await rm(root, {recursive: true});
    }
  });

  test('keeps generated Storybook output outside this check', async () => {
    const root = await fixture({
      'README.md': '# Repository',
      'apps/storybook/storybook-output/client-agent/assets/README.md': '[missing](nowhere.md)',
      'apps/storybook/storybook-static/README.md': '[missing](nowhere.md)',
      'apps/storybook/.storybook-output-staging-random/client-agent/assets/README.md':
        '[missing](nowhere.md)',
      'apps/storybook/.storybook-output-previous-random/client-agent/assets/README.md':
        '[missing](nowhere.md)',
    });
    try {
      assert.deepEqual(await collectDocumentationFiles(root), ['README.md']);
      assert.deepEqual((await checkRepositoryDocumentation(root)).violations, []);
    } finally {
      await rm(root, {recursive: true});
    }
  });
});
