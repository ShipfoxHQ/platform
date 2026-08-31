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

export type CloudflarePagesCommandConfig = {
  command: string;
  args?: string[];
};

export type CloudflarePagesValidationConfig = CloudflarePagesCommandConfig & {
  setup?: CloudflarePagesCommandConfig;
};

export type CloudflarePagesArtifactConfig = {
  metadataPath?: string;
};

export type CloudflarePagesConfig = {
  apps: CloudflarePagesApp[];
  environments: Record<string, CloudflarePagesEnvironment>;
  forcePaths: string[];
  artifact?: CloudflarePagesArtifactConfig;
  validation?: CloudflarePagesValidationConfig;
};

function isCommandConfig(value: unknown): value is CloudflarePagesCommandConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const command = value as Record<string, unknown>;
  return (
    typeof command.command === 'string' &&
    command.command.length > 0 &&
    (command.args === undefined ||
      (Array.isArray(command.args) &&
        command.args.every((argument: unknown) => typeof argument === 'string')))
  );
}

function isValidationConfig(value: unknown): value is CloudflarePagesValidationConfig {
  if (!isCommandConfig(value)) return false;

  const validation = value as CloudflarePagesCommandConfig & {setup?: unknown};
  return validation.setup === undefined || isCommandConfig(validation.setup);
}

function isArtifactConfig(value: unknown): value is CloudflarePagesArtifactConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const metadataPath = (value as Record<string, unknown>).metadataPath;
  return (
    metadataPath === undefined || (typeof metadataPath === 'string' && metadataPath.length > 0)
  );
}

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
  validateBuildEnvironmentMap(configPath, app.id, buildEnv);
  validateBuildFromEnvironmentMap(configPath, app.id, buildFromEnv);
  validateBuildEnvironmentOverlap(configPath, app.id, buildEnv, buildFromEnv);
}

function validateBuildEnvironmentMap(configPath: string, appId: unknown, value: unknown): void {
  if (value === undefined) return;
  const invalid =
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([environment, values]) =>
        environment.length === 0 ||
        typeof values !== 'object' ||
        values === null ||
        Array.isArray(values) ||
        Object.entries(values).some(
          ([name, item]) => !environmentVariableNamePattern.test(name) || typeof item !== 'string',
        ),
    );
  if (invalid)
    throw new Error(`${configPath} app ${appId} build.env must map environments to env values`);
}

function validateBuildFromEnvironmentMap(configPath: string, appId: unknown, value: unknown): void {
  if (value === undefined) return;
  const invalid =
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([name, source]) =>
        !environmentVariableNamePattern.test(name) ||
        typeof source !== 'string' ||
        !environmentVariableNamePattern.test(source),
    );
  if (invalid)
    throw new Error(`${configPath} app ${appId} build.fromEnv must map env names to CI env names`);
}

function validateBuildEnvironmentOverlap(
  configPath: string,
  appId: unknown,
  buildEnv: unknown,
  buildFromEnv: unknown,
): void {
  const environments = (buildEnv as Record<string, Record<string, string>> | undefined) ?? {};
  const names = Object.keys((buildFromEnv as Record<string, string> | undefined) ?? {});
  for (const [environment, values] of Object.entries(environments)) {
    for (const name of names) {
      if (Object.hasOwn(values, name)) {
        throw new Error(
          `${configPath} app ${appId} build variable ${name} is defined in both ${environment} env and fromEnv`,
        );
      }
    }
  }
}

function validateCloudflarePagesApp(configPath: string, value: unknown, ids: Set<unknown>): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${configPath} apps must contain objects`);
  }
  const app = value as Record<string, unknown>;
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
  validateCloudflareProjects(configPath, app);
  validateBuildConfig(configPath, app);
  validateCloudflareVerification(configPath, app);
}

function validateCloudflareProjects(configPath: string, app: Record<string, unknown>): void {
  if (typeof app.project !== 'string' || app.project.length === 0) {
    throw new Error(`${configPath} app ${app.id} must define a Cloudflare Pages project`);
  }
  if (app.projects === undefined) return;
  const invalid =
    typeof app.projects !== 'object' ||
    app.projects === null ||
    Array.isArray(app.projects) ||
    Object.entries(app.projects).some(
      ([environment, project]) =>
        environment.length === 0 || typeof project !== 'string' || project.length === 0,
    );
  if (invalid)
    throw new Error(`${configPath} app ${app.id} projects must map environments to project names`);
}

function validateCloudflareVerification(configPath: string, app: Record<string, unknown>): void {
  if (app.verify === undefined) return;
  if (typeof app.verify !== 'object' || app.verify === null) {
    throw new Error(`${configPath} app ${app.id} verify must be an object`);
  }
  const verify = app.verify as Record<string, unknown>;
  if (
    verify.metadataPath !== undefined &&
    (typeof verify.metadataPath !== 'string' || verify.metadataPath.length === 0)
  ) {
    throw new Error(`${configPath} app ${app.id} metadataPath must be a string`);
  }
  if (
    verify.endpoints !== undefined &&
    (!Array.isArray(verify.endpoints) || verify.endpoints.some(invalidVerificationEndpoint))
  ) {
    throw new Error(`${configPath} app ${app.id} endpoints must define paths`);
  }
}

function invalidVerificationEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint === 'string') return endpoint.length === 0;
  if (typeof endpoint !== 'object' || endpoint === null) return true;
  const value = endpoint as {id?: unknown; path?: unknown; requireNonEmpty?: unknown};
  if (typeof value.path !== 'string' || value.path.length === 0) return true;
  if (value.id !== undefined && (typeof value.id !== 'string' || value.id.length === 0))
    return true;
  return value.requireNonEmpty !== undefined && typeof value.requireNonEmpty !== 'boolean';
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
    validateCloudflarePagesApp(configPath, app, ids);
  }

  const environments = validateCloudflareEnvironments(
    configPath,
    config.environments ?? defaultCloudflarePagesEnvironments,
  );
  const forcePaths = validateForcePaths(configPath, config.forcePaths ?? []);
  const artifact = validateArtifactConfig(configPath, config.artifact);
  const validation = validateValidationConfig(configPath, config.validation);

  return {
    apps: config.apps as CloudflarePagesApp[],
    environments: environments as Record<string, CloudflarePagesEnvironment>,
    forcePaths: forcePaths as string[],
    ...(artifact === undefined
      ? {}
      : {
          artifact:
            artifact.metadataPath === undefined ? {} : {metadataPath: artifact.metadataPath},
        }),
    ...(validation === undefined ? {} : {validation}),
  };
}

function validateCloudflareEnvironments(
  configPath: string,
  environments: unknown,
): Record<string, CloudflarePagesEnvironment> {
  const invalid =
    typeof environments !== 'object' ||
    environments === null ||
    Array.isArray(environments) ||
    Object.entries(environments).some(([name, settings]) =>
      invalidEnvironmentSetting(name, settings),
    );
  if (invalid) throw new Error(`${configPath} environments must define valid branch settings`);
  return environments as Record<string, CloudflarePagesEnvironment>;
}

function invalidEnvironmentSetting(environment: string, settings: unknown): boolean {
  if (
    environment.length === 0 ||
    typeof settings !== 'object' ||
    settings === null ||
    Array.isArray(settings)
  )
    return true;
  const branch = (settings as {branch?: unknown}).branch;
  return (
    branch !== undefined && branch !== null && (typeof branch !== 'string' || branch.length === 0)
  );
}

function validateForcePaths(configPath: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${configPath} must contain a string forcePaths array`);
  }
  return value as string[];
}

function validateArtifactConfig(configPath: string, value: unknown) {
  if (value !== undefined && !isArtifactConfig(value)) {
    throw new Error(`${configPath} artifact must define a valid metadataPath`);
  }
  return value;
}

function validateValidationConfig(configPath: string, value: unknown) {
  if (value !== undefined && !isValidationConfig(value)) {
    throw new Error(`${configPath} validation must define commands and string args`);
  }
  return value;
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
  const isExplicitDeployment = eventName === 'deployment';
  const shouldDeploy =
    isMainPush || isExplicitDeployment || forcedByFile || affectedTargets.length > 0;
  let selectedApps: CloudflarePagesApp[] = [];
  if (shouldDeploy) {
    selectedApps = isMainPush || isExplicitDeployment || forcedByFile ? apps : affectedApps;
  }

  let reason = 'no Pages target is affected';
  if (isMainPush) reason = 'main push';
  else if (isExplicitDeployment) reason = 'explicit deployment';
  else if (forcedByFile) reason = 'Pages workflow or application configuration changed';
  else if (affectedTargets.length > 0) reason = 'Turbo affected Pages target detected';

  return {
    shouldDeploy,
    reason,
    affectedPackages,
    affectedTargets,
    affectedApps: affectedApps.map((app) => app.id),
    selectedApps: selectedApps.map((app) => app.id),
    changedFiles,
  };
}
