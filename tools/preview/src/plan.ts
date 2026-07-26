import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

function runGit(args, cwd) {
  return execFileSync('git', args, {cwd, encoding: 'utf8'})
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
}

function readTurboPackages(cwd) {
  const output = execFileSync('pnpm', ['exec', 'turbo', 'ls', '--affected', '--output=json'], {
    cwd,
    encoding: 'utf8',
  });
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) throw new Error('Turbo did not return a JSON package list');

  const turboList = JSON.parse(output.slice(jsonStart));
  return (turboList.packages?.items ?? [])
    .map((item) => item.name)
    .filter((name) => typeof name === 'string');
}

function isPathWithin(path, parent) {
  return path === parent || path.startsWith(`${parent}/`);
}

function hasForcedChange(changedFiles, forcePaths) {
  return changedFiles.some((file) => forcePaths.some((path) => isPathWithin(file, path)));
}

/**
 * Read the small application-owned configuration used by the generic preview
 * commands.
 */
export async function readPreviewConfig(configPath, cwd = process.cwd()) {
  const path = resolve(cwd, configPath);
  const config = JSON.parse(await readFile(path, 'utf8'));

  if (
    !Array.isArray(config.targets) ||
    config.targets.some((target) => typeof target !== 'string')
  ) {
    throw new Error(`${configPath} must contain a string targets array`);
  }
  if (
    !Array.isArray(config.forcePaths) ||
    config.forcePaths.some((forcePath) => typeof forcePath !== 'string')
  ) {
    throw new Error(`${configPath} must contain a string forcePaths array`);
  }

  return config;
}

/**
 * Produce a provider-neutral affected preview decision from Turbo and git.
 */
export function createPreviewPlan({
  targets,
  forcePaths,
  eventName = process.env.GITHUB_EVENT_NAME,
  base = process.env.TURBO_SCM_BASE,
  head = process.env.TURBO_SCM_HEAD ?? 'HEAD',
  cwd = process.cwd(),
  affectedPackages = readTurboPackages(cwd),
  changedFiles = base === undefined || base.length === 0
    ? []
    : runGit(['diff', '--name-only', `${base}...${head}`], cwd),
}) {
  const affectedTargets = affectedPackages.filter((packageName) => targets.includes(packageName));
  const forcedByFile = hasForcedChange(changedFiles, forcePaths);
  const isMainPush = eventName === 'push';
  const shouldDeploy = isMainPush || forcedByFile || affectedTargets.length > 0;

  return {
    shouldDeploy,
    reason: isMainPush
      ? 'main push'
      : forcedByFile
        ? 'preview workflow or application configuration changed'
        : affectedTargets.length > 0
          ? 'Turbo affected preview target detected'
          : 'no preview target is affected',
    affectedPackages,
    affectedTargets,
    changedFiles,
  };
}
