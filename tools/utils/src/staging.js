import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {getWorkspaceRootPath} from './path.js';
import {productionizeImports} from './productionize.js';

/**
 * Copies built package output into a pruned workspace and removes source-only
 * package import conditions from the staged manifests.
 *
 * Turbo builds the workspace before either image path runs. The prune output
 * contains package sources and manifests, but not the cached dist/ directories
 * that those packages need at runtime. Keeping this overlay in one helper makes
 * Docker and Packer consume the same production dependency tree.
 */
export function overlayBuiltOutputs({prunedRoot, workspaceRoot = getWorkspaceRootPath()}) {
  if (!workspaceRoot) throw new Error('Unable to determine the workspace root for built outputs.');

  for (const packageJson of findPackageJsonFiles(prunedRoot)) {
    const packagePath = relative(prunedRoot, dirname(packageJson));
    if (!packagePath) continue;

    const source = join(workspaceRoot, packagePath, 'dist');
    if (!existsSync(source)) {
      if (buildsToDist(join(workspaceRoot, packagePath, 'package.json')))
        throw new Error(
          `${packagePath} has no built dist/ at ${source}. Build the workspace before staging the pruned workspace.`,
        );
      continue;
    }

    cpSync(source, join(prunedRoot, packagePath, 'dist'), {recursive: true});
    productionizePackageImports(packageJson);
  }
}

function productionizePackageImports(packageJsonPath) {
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const imports = productionizeImports(manifest.imports);
  if (imports === manifest.imports) return;

  manifest.imports = imports;
  writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function buildsToDist(packageJsonPath) {
  if (!existsSync(packageJsonPath)) return false;
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  return Boolean(manifest.scripts?.build);
}

function findPackageJsonFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    if (statSync(entryPath).isDirectory()) found.push(...findPackageJsonFiles(entryPath));
    else if (entry === 'package.json') found.push(entryPath);
  }
  return found;
}
