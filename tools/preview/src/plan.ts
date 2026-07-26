import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

export type PreviewEndpoint =
  | string
  | {
      id?: string;
      path: string;
      requireNonEmpty?: boolean;
    };

export type PreviewApp = {
  id: string;
  target: string;
  affectedTargets?: string[];
  directory: string;
  provider: {
    type: string;
    project: string;
  };
  verify?: {
    metadataPath?: string;
    endpoints?: PreviewEndpoint[];
  };
};

export type PreviewConfig = {
  apps: PreviewApp[];
  forcePaths: string[];
};

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

  if (!Array.isArray(config.apps) || config.apps.length === 0) {
    throw new Error(`${configPath} must contain a non-empty apps array`);
  }

  const ids = new Set();
  for (const app of config.apps) {
    if (typeof app !== 'object' || app === null) {
      throw new Error(`${configPath} apps must contain objects`);
    }
    for (const field of ['id', 'target', 'directory']) {
      if (typeof app[field] !== 'string' || app[field].length === 0) {
        throw new Error(`${configPath} app ${field} is required`);
      }
    }
    if (
      app.affectedTargets !== undefined &&
      (!Array.isArray(app.affectedTargets) ||
        app.affectedTargets.some((target) => typeof target !== 'string' || target.length === 0))
    ) {
      throw new Error(`${configPath} app ${app.id} affectedTargets must be strings`);
    }
    if (ids.has(app.id)) throw new Error(`${configPath} contains duplicate app id ${app.id}`);
    ids.add(app.id);

    if (
      typeof app.provider !== 'object' ||
      app.provider === null ||
      typeof app.provider.type !== 'string' ||
      app.provider.type.length === 0 ||
      typeof app.provider.project !== 'string' ||
      app.provider.project.length === 0
    ) {
      throw new Error(`${configPath} app ${app.id} must define provider type and project`);
    }

    if (app.verify !== undefined) {
      if (typeof app.verify !== 'object' || app.verify === null) {
        throw new Error(`${configPath} app ${app.id} verify must be an object`);
      }
      if (
        app.verify.metadataPath !== undefined &&
        (typeof app.verify.metadataPath !== 'string' || app.verify.metadataPath.length === 0)
      ) {
        throw new Error(`${configPath} app ${app.id} metadataPath must be a string`);
      }
      if (
        app.verify.endpoints !== undefined &&
        (!Array.isArray(app.verify.endpoints) ||
          app.verify.endpoints.some(
            (endpoint) =>
              (typeof endpoint === 'string' && endpoint.length === 0) ||
              (typeof endpoint === 'object' &&
                (endpoint === null ||
                  typeof endpoint.path !== 'string' ||
                  endpoint.path.length === 0)) ||
              (typeof endpoint !== 'string' && typeof endpoint !== 'object'),
          ))
      ) {
        throw new Error(`${configPath} app ${app.id} endpoints must define paths`);
      }
    }
  }

  const forcePaths = config.forcePaths ?? [];
  if (!Array.isArray(forcePaths) || forcePaths.some((forcePath) => typeof forcePath !== 'string')) {
    throw new Error(`${configPath} must contain a string forcePaths array`);
  }

  return {apps: config.apps, forcePaths} as PreviewConfig;
}

/**
 * Produce a provider-neutral affected preview decision from Turbo and git.
 */
export function createPreviewPlan({
  apps,
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
  const affectedTargets = affectedPackages.filter((packageName) =>
    apps.some((app) => [app.target, ...(app.affectedTargets ?? [])].includes(packageName)),
  );
  const affectedApps = apps.filter((app) =>
    [app.target, ...(app.affectedTargets ?? [])].some((target) => affectedTargets.includes(target)),
  );
  const forcedByFile = hasForcedChange(changedFiles, forcePaths);
  const isMainPush = eventName === 'push';
  const shouldDeploy = isMainPush || forcedByFile || affectedTargets.length > 0;
  const selectedApps = shouldDeploy ? (isMainPush || forcedByFile ? apps : affectedApps) : [];

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
    affectedApps: affectedApps.map((app) => app.id),
    selectedApps: selectedApps.map((app) => app.id),
    changedFiles,
  };
}
