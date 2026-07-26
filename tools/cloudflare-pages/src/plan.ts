import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

export type CloudflarePagesEndpoint =
  | string
  | {
      id?: string;
      path: string;
      requireNonEmpty?: boolean;
    };

export type CloudflarePagesBuildConfig = {
  task?: string;
  env?: Record<string, Record<string, string>>;
  fromEnv?: Record<string, string>;
};

export type CloudflarePagesApp = {
  id: string;
  target: string;
  affectedTargets?: string[];
  directory: string;
  project: string;
  projects?: Record<string, string>;
  build?: CloudflarePagesBuildConfig;
  verify?: {
    metadataPath?: string;
    endpoints?: CloudflarePagesEndpoint[];
  };
};

export type CloudflarePagesEnvironment = {
  branch?: string | null;
};

export type CloudflarePagesConfig = {
  apps: CloudflarePagesApp[];
  environments: Record<string, CloudflarePagesEnvironment>;
  forcePaths: string[];
};

export const defaultCloudflarePagesEnvironments = {
  preview: {branch: 'pr-{pullRequest}'},
  staging: {branch: 'staging'},
  production: {branch: 'main'},
} satisfies Record<string, CloudflarePagesEnvironment>;

function runGit(args: string[], cwd: string): string[] {
  return execFileSync('git', args, {cwd, encoding: 'utf8'})
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
}

function readTurboPackages(cwd: string): string[] {
  const output = execFileSync('pnpm', ['exec', 'turbo', 'ls', '--affected', '--output=json'], {
    cwd,
    encoding: 'utf8',
  });
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) throw new Error('Turbo did not return a JSON package list');

  const turboList: unknown = JSON.parse(output.slice(jsonStart));
  if (typeof turboList !== 'object' || turboList === null) {
    throw new Error('Turbo returned an invalid package list');
  }
  const packages = (turboList as Record<string, unknown>).packages;
  if (typeof packages !== 'object' || packages === null || Array.isArray(packages)) {
    throw new Error('Turbo returned a package list without packages.items');
  }
  const items = (packages as Record<string, unknown>).items;
  if (!Array.isArray(items)) {
    throw new Error('Turbo returned a package list without packages.items');
  }
  return items
    .map((item: unknown) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
      const name = (item as {name?: unknown}).name;
      return typeof name === 'string' ? name : undefined;
    })
    .filter((name: string | undefined): name is string => name !== undefined);
}

function isPathWithin(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

function hasForcedChange(changedFiles: string[], forcePaths: string[]): boolean {
  return changedFiles.some((file) => forcePaths.some((path) => isPathWithin(file, path)));
}

const environmentVariableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateBuildConfig(configPath: string, app: Record<string, unknown>): void {
  if (app.build === undefined) return;
  if (typeof app.build !== 'object' || app.build === null || Array.isArray(app.build)) {
    throw new Error(`${configPath} app ${app.id} build must be an object`);
  }
  const build = app.build as Record<string, unknown>;
  const buildEnv = build.env;
  const buildFromEnv = build.fromEnv;
  if (build.task !== undefined && (typeof build.task !== 'string' || build.task.length === 0)) {
    throw new Error(`${configPath} app ${app.id} build.task must be a non-empty string`);
  }

  if (buildEnv !== undefined) {
    if (
      typeof buildEnv !== 'object' ||
      buildEnv === null ||
      Array.isArray(buildEnv) ||
      Object.entries(buildEnv).some(
        ([environment, values]) =>
          environment.length === 0 ||
          typeof values !== 'object' ||
          values === null ||
          Array.isArray(values) ||
          Object.entries(values).some(
            ([name, value]) =>
              !environmentVariableNamePattern.test(name) || typeof value !== 'string',
          ),
      )
    ) {
      throw new Error(`${configPath} app ${app.id} build.env must map environments to env values`);
    }
  }

  if (buildFromEnv !== undefined) {
    if (
      typeof buildFromEnv !== 'object' ||
      buildFromEnv === null ||
      Array.isArray(buildFromEnv) ||
      Object.entries(buildFromEnv).some(
        ([name, source]) =>
          !environmentVariableNamePattern.test(name) ||
          typeof source !== 'string' ||
          !environmentVariableNamePattern.test(source),
      )
    ) {
      throw new Error(
        `${configPath} app ${app.id} build.fromEnv must map env names to CI env names`,
      );
    }
  }

  for (const [environment, values] of Object.entries(
    (buildEnv as Record<string, Record<string, string>> | undefined) ?? {},
  )) {
    for (const name of Object.keys((buildFromEnv as Record<string, string> | undefined) ?? {})) {
      if (Object.hasOwn(values as object, name)) {
        throw new Error(
          `${configPath} app ${app.id} build variable ${name} is defined in both ${environment} env and fromEnv`,
        );
      }
    }
  }
}

/**
 * Read the application-owned configuration used by the Cloudflare Pages
 * deployment commands.
 */
export async function readCloudflarePagesConfig(
  configPath: string,
  cwd: string = process.cwd(),
): Promise<CloudflarePagesConfig> {
  const path = resolve(cwd, configPath);
  const config: Record<string, unknown> = JSON.parse(await readFile(path, 'utf8'));

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
        app.affectedTargets.some(
          (target: unknown) => typeof target !== 'string' || target.length === 0,
        ))
    ) {
      throw new Error(`${configPath} app ${app.id} affectedTargets must be strings`);
    }
    if (ids.has(app.id)) throw new Error(`${configPath} contains duplicate app id ${app.id}`);
    ids.add(app.id);

    if (typeof app.project !== 'string' || app.project.length === 0) {
      throw new Error(`${configPath} app ${app.id} must define a Cloudflare Pages project`);
    }
    if (
      app.projects !== undefined &&
      (typeof app.projects !== 'object' ||
        app.projects === null ||
        Array.isArray(app.projects) ||
        Object.entries(app.projects).some(
          ([environment, project]) =>
            environment.length === 0 || typeof project !== 'string' || project.length === 0,
        ))
    ) {
      throw new Error(
        `${configPath} app ${app.id} projects must map environments to project names`,
      );
    }

    validateBuildConfig(configPath, app);

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
          app.verify.endpoints.some((endpoint: unknown) => {
            if (typeof endpoint === 'string') return endpoint.length === 0;
            if (typeof endpoint !== 'object' || endpoint === null) return true;
            const endpointObject = endpoint as {
              id?: unknown;
              path?: unknown;
              requireNonEmpty?: unknown;
            };
            return (
              typeof endpointObject.path !== 'string' ||
              endpointObject.path.length === 0 ||
              (endpointObject.id !== undefined &&
                (typeof endpointObject.id !== 'string' || endpointObject.id.length === 0)) ||
              (endpointObject.requireNonEmpty !== undefined &&
                typeof endpointObject.requireNonEmpty !== 'boolean')
            );
          }))
      ) {
        throw new Error(`${configPath} app ${app.id} endpoints must define paths`);
      }
    }
  }

  const environments = config.environments ?? defaultCloudflarePagesEnvironments;
  if (
    typeof environments !== 'object' ||
    environments === null ||
    Array.isArray(environments) ||
    Object.entries(environments).some(([environment, settings]) => {
      if (
        environment.length === 0 ||
        typeof settings !== 'object' ||
        settings === null ||
        Array.isArray(settings)
      ) {
        return true;
      }
      const branch = (settings as {branch?: unknown}).branch;
      return (
        branch !== undefined &&
        branch !== null &&
        (typeof branch !== 'string' || branch.length === 0)
      );
    })
  ) {
    throw new Error(`${configPath} environments must define valid branch settings`);
  }

  const forcePaths = config.forcePaths ?? [];
  if (!Array.isArray(forcePaths) || forcePaths.some((forcePath) => typeof forcePath !== 'string')) {
    throw new Error(`${configPath} must contain a string forcePaths array`);
  }

  return {apps: config.apps, environments, forcePaths} as CloudflarePagesConfig;
}

/**
 * Produce an affected Cloudflare Pages deployment decision from Turbo and git.
 */
export function createCloudflarePagesPlan({
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
}: {
  apps: CloudflarePagesApp[];
  forcePaths: string[];
  eventName?: string | undefined;
  base?: string | undefined;
  head?: string | undefined;
  cwd?: string | undefined;
  affectedPackages?: string[] | undefined;
  changedFiles?: string[] | undefined;
}): {
  shouldDeploy: boolean;
  reason: string;
  affectedPackages: string[];
  affectedTargets: string[];
  affectedApps: string[];
  selectedApps: string[];
  changedFiles: string[];
} {
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
        ? 'Pages workflow or application configuration changed'
        : affectedTargets.length > 0
          ? 'Turbo affected Pages target detected'
          : 'no Pages target is affected',
    affectedPackages,
    affectedTargets,
    affectedApps: affectedApps.map((app) => app.id),
    selectedApps: selectedApps.map((app) => app.id),
    changedFiles,
  };
}
