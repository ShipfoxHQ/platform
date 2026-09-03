import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

// Keeps page-harness imports intentional because each one mounts router, query,
// and API-client providers around the test.
const PAGE_HARNESS_ALLOWLIST = [
  'src/components/workflow-run-summary/workflow-run-attempt-switcher.test.tsx',
  'src/components/workflow-run-view/workflow-run-view.test.tsx',
  'src/hooks/api/workflow-job-detail.test.tsx',
  'src/pages/project-workflows-page.test.tsx',
  'src/pages/workflow-job-detail-page.test.tsx',
  'src/pages/workflow-run-pages.test.tsx',
];

const srcDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(srcDir);

function collectTestFiles(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectTestFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.test.tsx') ? [entryPath] : [];
  });
}

describe('page harness budget', () => {
  it('is imported only by the allowlisted page-wiring tests', () => {
    const harnessImporters = collectTestFiles(srcDir)
      .filter((file) => readFileSync(file, 'utf8').includes("'#test/pages"))
      .map((file) => relative(packageRoot, file))
      .sort();

    expect(harnessImporters).toEqual(PAGE_HARNESS_ALLOWLIST);
  });
});
