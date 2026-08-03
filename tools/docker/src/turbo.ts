import {execSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import {join} from 'node:path';
import {
  buildShellCommand,
  getProjectFilePath,
  overlayBuiltOutputs,
  productionizeImports,
} from '@shipfox/tool-utils';

export {productionizeImports} from '@shipfox/tool-utils';

/**
 * Prepare the Docker build context for a node app the "build outside Docker,
 * ingest dist" way. `turbo prune` writes a self-contained workspace into `out/`,
 * then each pruned package's already-built (turbo-cached) `dist/` is overlaid
 * into `out/full/`. The image ingests those `dist/`s plus a real `node_modules`
 * and never recompiles TypeScript: `shipfox-swc` transpiles per file and does
 * not bundle, so the workspace `dist/`s are what the running app needs.
 */
export function setupContext(packageName: string) {
  const contextPath = getProjectFilePath('out');
  rmSync(contextPath, {recursive: true, force: true});

  const prune = buildShellCommand([
    'turbo',
    'prune',
    '--docker',
    '--out-dir',
    contextPath,
    packageName,
  ]);
  execSync(prune, {stdio: 'inherit'});

  overlayBuiltOutputs({prunedRoot: join(contextPath, 'full')});
}
