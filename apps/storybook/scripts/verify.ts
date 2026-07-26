import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  assertPreviewMetadata,
  formatMetrics,
  getCommitShaFromEnv,
  getMaxFileBytes,
  verifyPreviewArtifact,
} from './artifact.js';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(appRoot, 'storybook-output');
const staticRoot = outputRoot;

async function main(): Promise<void> {
  const metadata = JSON.parse(
    await readFile(resolve(staticRoot, 'preview-metadata.json'), 'utf8'),
  ) as unknown;
  assertPreviewMetadata(metadata, getCommitShaFromEnv());

  const metrics = await verifyPreviewArtifact({staticRoot, maxFileBytes: getMaxFileBytes()});
  process.stdout.write(`Verified Storybook preview artifact at ${outputRoot}\n`);
  process.stdout.write(`${formatMetrics(metrics)}\n`);
}

await main();
