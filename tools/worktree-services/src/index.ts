import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {homedir} from 'node:os';
import {basename, dirname, resolve} from 'node:path';

const composeProjectNameMaxLength = 63;
const composeProjectNamePrefix = 'shipfox-';
const portBlockSize = 20;
const tcpPortPattern = /^\d+$/u;
const composeProjectNameInvalidChars = /[^a-z0-9_-]+/gu;
const composeProjectNameLeadingDashes = /^-+/u;
const composeProjectNameTrailingDashes = /-+$/u;

export const defaultPortRange = Object.freeze({
  start: 20_000,
  end: 45_999,
  blockSize: portBlockSize,
});

export const standardPorts = {
  client: 0,
  api: 1,
  postgres: 2,
  temporal: 3,
  docs: 4,
  garageS3: 5,
  giteaHttp: 6,
  giteaSsh: 7,
  otelInstanceMetrics: 8,
  otelServiceMetrics: 9,
  linearMcp: 10,
  githubApi: 11,
  slackApi: 12,
  otelTemporalMetrics: 13,
} as const;

export type StandardPortName = keyof typeof standardPorts;
export type StandardPortDefinitions = Readonly<Record<StandardPortName, number>>;
export type ResolvedPorts = {base: number} & Record<StandardPortName, number>;
export type PortRange = Readonly<{start: number; end: number; blockSize: number}>;
export type WorktreeEnvironment = Record<string, string | undefined>;

export interface WorktreeServicesAppEnvContext {
  ports: ResolvedPorts;
  projectName: string;
  workspaceId: string;
  workspacePath: string;
}

export interface WorktreeServicesConfig {
  appEnv?: (context: WorktreeServicesAppEnvContext) => Record<string, string>;
  compose: {
    initCommands?: readonly string[];
    services: readonly string[];
  };
  composeFile: string;
  ports: StandardPortDefinitions;
}

export interface WorktreeServicesOptions {
  env?: WorktreeEnvironment;
  registryFile?: string;
  repositoryId?: string;
  rootPath?: string;
  workspacePath?: string;
}

export interface WorktreeServices {
  destroy(): void;
  status(): void;
  stop(): void;
  up(): void;
}

export function defineWorktreeServices(config: WorktreeServicesConfig): WorktreeServicesConfig {
  if (!config || typeof config !== 'object') fail('Worktree services config must be an object.');
  if (!config.composeFile || typeof config.composeFile !== 'string') {
    fail('Worktree services config must define composeFile.');
  }
  if (!config.compose || !Array.isArray(config.compose.services)) {
    fail('Worktree services config must define compose.services.');
  }
  if (config.compose.services.some((service) => typeof service !== 'string' || !service)) {
    fail('Worktree services compose.services must contain non-empty service names.');
  }
  if (config.compose.initCommands?.some((command) => typeof command !== 'string' || !command)) {
    fail('Worktree services compose.initCommands must contain service names.');
  }
  validatePortDefinitions(config.ports);
  return config;
}

export function standardAppEnv(ports: ResolvedPorts): Record<string, string> {
  const apiUrl = `http://localhost:${ports.api}`;
  const clientUrl = `http://localhost:${ports.client}`;
  return {
    API_PORT: String(ports.api),
    CLIENT_BASE_URL: clientUrl,
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: String(ports.postgres),
    POSTGRES_USERNAME: 'shipfox',
    POSTGRES_PASSWORD: 'password',
    POSTGRES_DATABASE: 'api',
    TEMPORAL_ADDRESS: `localhost:${ports.temporal}`,
    GITEA_BASE_URL: `http://localhost:${ports.giteaHttp}`,
    GITHUB_API_BASE_URL: `http://127.0.0.1:${ports.githubApi}`,
    OBJECT_STORAGE_S3_ENDPOINT: `http://localhost:${ports.garageS3}`,
    LINEAR_MCP_ENDPOINT: `http://127.0.0.1:${ports.linearMcp}/mcp`,
    SLACK_API_BASE_URL: `http://127.0.0.1:${ports.slackApi}`,
    OTEL_INSTANCE_METRICS_PORT: String(ports.otelInstanceMetrics),
    OTEL_SERVICE_METRICS_PORT: String(ports.otelServiceMetrics),
    OTEL_TEMPORAL_METRICS_PORT: String(ports.otelTemporalMetrics),
    VITE_API_URL: apiUrl,
    SHIPFOX_CLIENT_PORT: String(ports.client),
    SHIPFOX_DOCS_PORT: String(ports.docs),
    SHIPFOX_API_URL: apiUrl,
    SHIPFOX_RUNNER_API_URL: `http://host.docker.internal:${ports.api}`,
    SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS: 'host.docker.internal:host-gateway',
  };
}

export function createWorktreeServices(
  config: WorktreeServicesConfig,
  options: WorktreeServicesOptions = {},
): WorktreeServices {
  const validatedConfig = defineWorktreeServices(config);
  const env = options.env ?? process.env;
  const workspacePath = resolve(options.workspacePath ?? process.cwd());
  const rootPath = options.rootPath ?? env.CONDUCTOR_ROOT_PATH;
  const registryFile = options.registryFile ?? defaultPortLeasesFile();
  const stateDir = resolve(workspacePath, '.context/local-services');
  const portsFile = resolve(stateDir, 'ports.env');
  const composeEnvFile = resolve(stateDir, 'compose.env');
  const appEnvFile = resolve(stateDir, 'env');
  const workspaceId = workspaceIdentity(workspacePath, env);
  const repositoryId = options.repositoryId ?? repositoryIdentity(workspacePath, rootPath);
  const projectName = resolveProjectName(
    workspacePath,
    portLeaseKey(repositoryId, workspaceId),
    portsFile,
  );

  return {
    up() {
      const composeFile = resolveComposeFile({
        composeFile: validatedConfig.composeFile,
        workspacePath,
        rootPath,
      });
      mkdirSync(stateDir, {recursive: true});
      const portRange = resolvePortRange(env);
      const ports = portsFromBase(
        leasePortBlock({repositoryId, workspaceId, workspacePath, registryFile, portRange}),
        validatedConfig.ports,
      );

      writeEnvFile(portsFile, {
        SHIPFOX_WORKTREE_SERVICES_WORKSPACE: basename(workspacePath),
        SHIPFOX_WORKTREE_SERVICES_WORKSPACE_ID: workspaceId,
        SHIPFOX_WORKTREE_SERVICES_WORKSPACE_PATH: workspacePath,
        SHIPFOX_WORKTREE_SERVICES_PROJECT: projectName,
        SHIPFOX_PORT_RANGE_START: String(portRange.start),
        SHIPFOX_PORT_RANGE_END: String(portRange.end),
        SHIPFOX_PORT_BASE: String(ports.base),
        ...portEnv(ports),
      });
      writeEnvFile(composeEnvFile, composeEnv(ports));
      writeAppEnvFile(
        appEnvFile,
        standardAppEnv(ports),
        validatedConfig.appEnv?.({
          ports,
          projectName,
          workspaceId,
          workspacePath,
        }),
      );

      runDockerCompose(
        projectName,
        composeEnvFile,
        composeFile,
        ['up', '-d', '--wait', ...validatedConfig.compose.services],
        env,
      );
      for (const initCommand of validatedConfig.compose.initCommands ?? []) {
        runDockerCompose(
          projectName,
          composeEnvFile,
          composeFile,
          ['run', '--rm', initCommand],
          env,
        );
      }
    },
    stop() {
      requireComposeState(composeEnvFile, workspacePath);
      runDockerCompose(
        projectName,
        composeEnvFile,
        resolveComposeFile({
          composeFile: validatedConfig.composeFile,
          workspacePath,
          rootPath,
          allowRootFallback: true,
        }),
        ['down', '--remove-orphans'],
        env,
      );
    },
    destroy() {
      if (existsSync(composeEnvFile)) {
        runDockerCompose(
          projectName,
          composeEnvFile,
          resolveComposeFile({
            composeFile: validatedConfig.composeFile,
            workspacePath,
            rootPath,
            allowRootFallback: true,
          }),
          ['down', '-v', '--remove-orphans'],
          env,
        );
      }
      rmSync(stateDir, {recursive: true, force: true});
      releasePortLease(workspacePath, repositoryId, workspaceId, registryFile);
    },
    status() {
      requireComposeState(composeEnvFile, workspacePath);
      runDockerCompose(
        projectName,
        composeEnvFile,
        resolveComposeFile({
          composeFile: validatedConfig.composeFile,
          workspacePath,
          rootPath,
          allowRootFallback: true,
        }),
        ['ps'],
        env,
      );
    },
  };
}

export function leasePortBlock({
  portRange = defaultPortRange,
  registryFile = defaultPortLeasesFile(),
  repositoryId,
  workspaceId,
  workspacePath = process.cwd(),
}: {
  portRange?: PortRange;
  registryFile?: string;
  repositoryId?: string;
  workspaceId?: string;
  workspacePath?: string;
} = {}): number {
  const resolvedWorkspacePath = resolve(workspacePath);
  const leaseWorkspaceId = workspaceId ?? resolvedWorkspacePath;
  const leaseRepositoryId = repositoryId ?? resolvedWorkspacePath;
  const leaseKey = portLeaseKey(leaseRepositoryId, leaseWorkspaceId);
  const resolvedPortRange = normalizePortRange(portRange);
  return withPortLeaseLock(() => {
    const registry = readPortLeaseRegistry(registryFile);
    const existingLease = registry.leases[leaseKey];
    if (existingLease) {
      existingLease.workspacePath = resolvedWorkspacePath;
      writePortLeaseRegistry(registry, registryFile);
      return existingLease.base;
    }

    const legacyLeaseKey = Object.entries(registry.leases).find(
      ([existingLeaseKey, lease]) =>
        existingLeaseKey === leaseWorkspaceId ||
        existingLeaseKey === resolvedWorkspacePath ||
        lease.workspacePath === resolvedWorkspacePath ||
        (lease.repositoryId === 'legacy' && lease.workspaceId === leaseWorkspaceId),
    )?.[0];
    if (legacyLeaseKey) {
      const legacyLease = registry.leases[legacyLeaseKey];
      if (!legacyLease) fail(`Invalid Shipfox port lease registry: ${registryFile}`);
      delete registry.leases[legacyLeaseKey];
      registry.leases[leaseKey] = {
        ...legacyLease,
        repositoryId: leaseRepositoryId,
        workspaceId: leaseWorkspaceId,
        workspacePath: resolvedWorkspacePath,
      };
      writePortLeaseRegistry(registry, registryFile);
      return legacyLease.base;
    }

    const base = nextAvailablePortBlock(registry, resolvedPortRange);
    registry.leases[leaseKey] = {
      allocatedAt: new Date().toISOString(),
      base,
      range: resolvedPortRange,
      repositoryId: leaseRepositoryId,
      workspaceId: leaseWorkspaceId,
      workspacePath: resolvedWorkspacePath,
    };
    writePortLeaseRegistry(registry, registryFile);
    return base;
  }, registryFile);
}

export function findStalePortLeases({
  registryFile = defaultPortLeasesFile(),
}: {
  registryFile?: string;
} = {}): Array<PortLease & {leaseKey: string}> {
  return withPortLeaseLock(() => {
    const registry = readPortLeaseRegistry(registryFile);
    return Object.entries(registry.leases)
      .map(([workspaceId, lease]) => ({
        ...lease,
        range: normalizePortRange(lease.range),
        leaseKey: workspaceId,
      }))
      .filter(
        (lease) => !existsSync(lease.workspacePath) && lease.workspaceId === lease.workspacePath,
      );
  }, registryFile);
}

export function removeStalePortLeases(
  staleLeases: Array<PortLease & {leaseKey: string}>,
  {registryFile = defaultPortLeasesFile()}: {registryFile?: string} = {},
): void {
  withPortLeaseLock(() => {
    const registry = readPortLeaseRegistry(registryFile);
    for (const {leaseKey, workspacePath} of staleLeases) {
      if (!existsSync(workspacePath)) delete registry.leases[leaseKey];
    }
    writePortLeaseRegistry(registry, registryFile);
  }, registryFile);
}

export function resolvePortRange(env: WorktreeEnvironment = process.env): PortRange {
  const start = configuredPortValue(env.SHIPFOX_PORT_RANGE_START, 'SHIPFOX_PORT_RANGE_START');
  const end = configuredPortValue(env.SHIPFOX_PORT_RANGE_END, 'SHIPFOX_PORT_RANGE_END');

  if (start === undefined && end === undefined) return {...defaultPortRange};
  if (start === undefined || end === undefined) {
    fail('SHIPFOX_PORT_RANGE_START and SHIPFOX_PORT_RANGE_END must be configured together.');
  }
  return normalizePortRange({start, end, blockSize: portBlockSize});
}

export function portsFromBase(
  base: number,
  definitions: StandardPortDefinitions = standardPorts,
): ResolvedPorts {
  validatePortDefinitions(definitions);
  return {
    base,
    ...Object.fromEntries(
      Object.entries(definitions).map(([name, offset]) => [name, base + offset]),
    ),
  } as ResolvedPorts;
}

export function composeProjectName(
  workspacePath: string,
  workspaceId = resolve(workspacePath),
): string {
  const resolvedWorkspacePath = resolve(workspacePath);
  const normalized = basename(resolvedWorkspacePath)
    .toLowerCase()
    .replace(composeProjectNameInvalidChars, '-')
    .replace(composeProjectNameLeadingDashes, '');
  const hash = createHash('sha256').update(workspaceId).digest('hex').slice(0, 8);
  const suffixLength =
    composeProjectNameMaxLength - composeProjectNamePrefix.length - hash.length - 1;
  const suffix =
    (normalized || 'workspace')
      .slice(0, suffixLength)
      .replace(composeProjectNameTrailingDashes, '') || 'workspace';
  return `${composeProjectNamePrefix}${suffix}-${hash}`;
}

export function parseEnvFile(content: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    entries[trimmed.slice(0, separatorIndex)] = trimmed.slice(separatorIndex + 1);
  }
  return entries;
}

export function resolveComposeFile({
  allowRootFallback = false,
  composeFile,
  rootPath,
  workspacePath = process.cwd(),
}: {
  allowRootFallback?: boolean;
  composeFile: string;
  rootPath?: string;
  workspacePath?: string;
}): string {
  const workspaceComposeFile = resolve(workspacePath, composeFile);
  if (existsSync(workspaceComposeFile)) return workspaceComposeFile;

  if (allowRootFallback && rootPath) {
    const rootComposeFile = resolve(rootPath, composeFile);
    if (existsSync(rootComposeFile)) return rootComposeFile;
  }

  fail(`Missing ${workspaceComposeFile}.`);
}

export interface PortLease {
  allocatedAt: string;
  base: number;
  range: PortRange;
  repositoryId: string;
  workspaceId: string;
  workspacePath: string;
}

interface PortLeaseRegistry {
  leases: Record<string, PortLease>;
  ranges: Record<string, PortRange & {nextBase: number}>;
  version: 3;
}

function defaultPortLeasesFile(): string {
  return resolve(homedir(), '.shipfox', 'shipfox-port-leases.json');
}

function workspaceIdentity(workspacePath: string, env: WorktreeEnvironment): string {
  return env.CONDUCTOR_WORKSPACE_ID || resolve(workspacePath);
}

function repositoryIdentity(workspacePath: string, rootPath: string | undefined): string {
  if (rootPath) return resolve(rootPath);
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: workspacePath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status === 0 && typeof result.stdout === 'string' && result.stdout.trim()) {
    return resolve(workspacePath, result.stdout.trim());
  }
  return workspacePath;
}

function portLeaseKey(repositoryId: string, workspaceId: string): string {
  return JSON.stringify([repositoryId, workspaceId]);
}

function resolveProjectName(workspacePath: string, workspaceId: string, portsFile: string): string {
  const existing = existsSync(portsFile) ? parseEnvFile(readFileSync(portsFile, 'utf8')) : {};
  if (
    existing.SHIPFOX_WORKTREE_SERVICES_WORKSPACE_ID === workspaceId ||
    existing.SHIPFOX_WORKTREE_SERVICES_WORKSPACE_PATH === workspacePath
  ) {
    return (
      existing.SHIPFOX_WORKTREE_SERVICES_PROJECT || composeProjectName(workspacePath, workspaceId)
    );
  }
  return composeProjectName(workspacePath, workspaceId);
}

function portEnv(ports: ResolvedPorts): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ports)
      .filter(([name]) => name !== 'base')
      .map(([name, port]) => [
        `SHIPFOX_${name.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase()}_PORT`,
        String(port),
      ]),
  );
}

function composeEnv(ports: ResolvedPorts): Record<string, string> {
  return {
    ...portEnv(ports),
    SHIPFOX_TEMPORAL_UI_PORT: '',
    SHIPFOX_GARAGE_RPC_PORT: '',
    SHIPFOX_GARAGE_ADMIN_PORT: '',
  };
}

function writeEnvFile(file: string, values: Record<string, string>): void {
  const body = `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
  writeFileSync(file, body);
}

function writeAppEnvFile(
  file: string,
  standardValues: Record<string, string>,
  customValues: Record<string, string> | undefined,
): void {
  const values = {...standardValues, ...customValues};
  const body = [
    '# Loaded by mise.toml for commands run in this worktree.',
    '# It is generated by shipfox-worktree-services.',
    ...Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(String(value))}`),
    '',
  ].join('\n');
  writeFileSync(file, body);
}

function runDockerCompose(
  projectName: string,
  composeEnvFile: string,
  composeFile: string,
  args: readonly string[],
  env: WorktreeEnvironment,
): void {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      composeEnvFile,
      '-f',
      composeFile,
      '--project-directory',
      dirname(composeFile),
      '-p',
      projectName,
      ...args,
    ],
    {env, stdio: 'inherit'},
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Docker Compose exited with status ${result.status ?? 1}.`);
  }
}

function requireComposeState(composeEnvFile: string, workspacePath: string): void {
  if (!existsSync(composeEnvFile)) {
    fail(`Missing ${composeEnvFile}. Run "shipfox-worktree-services up" first.`);
  }
  if (!existsSync(workspacePath)) fail(`Missing workspace: ${workspacePath}.`);
}

function readPortLeaseRegistry(registryFile: string): PortLeaseRegistry {
  if (!existsSync(registryFile)) {
    return {version: 3, ranges: {}, leases: {}};
  }

  let registry: unknown;
  try {
    registry = JSON.parse(readFileSync(registryFile, 'utf8'));
  } catch {
    fail(`Invalid Shipfox port lease registry: ${registryFile}`);
  }
  if (isRecord(registry) && (registry.version === 1 || registry.version === 2)) {
    return migrateLegacyPortLeaseRegistry(registry, registryFile);
  }
  if (
    !isRecord(registry) ||
    registry.version !== 3 ||
    !isRecord(registry.ranges) ||
    !isRecord(registry.leases)
  ) {
    fail(`Invalid Shipfox port lease registry: ${registryFile}`);
  }

  try {
    for (const [key, rangeState] of Object.entries(registry.ranges)) {
      const range = normalizePortRange(rangeState);
      if (key !== portRangeKey(range) || !isPortBlockStart(rangeState.nextBase, range)) {
        fail(`Invalid Shipfox port lease registry: ${registryFile}`);
      }
    }
    const leases: Record<string, PortLease> = {};
    for (const [leaseKey, lease] of Object.entries(registry.leases)) {
      if (!isRecord(lease)) fail(`Invalid Shipfox port lease registry: ${registryFile}`);
      const range = normalizePortRange(lease.range);
      if (
        !isPortBlockStart(lease.base, range) ||
        typeof lease.repositoryId !== 'string' ||
        typeof lease.workspaceId !== 'string' ||
        typeof lease.workspacePath !== 'string' ||
        leaseKey !== portLeaseKey(lease.repositoryId, lease.workspaceId)
      ) {
        fail(`Invalid Shipfox port lease registry: ${registryFile}`);
      }
      leases[leaseKey] = {
        allocatedAt: String(lease.allocatedAt),
        base: lease.base,
        range,
        repositoryId: lease.repositoryId,
        workspaceId: lease.workspaceId,
        workspacePath: lease.workspacePath,
      };
    }
    const ranges: PortLeaseRegistry['ranges'] = {};
    for (const [key, rangeState] of Object.entries(registry.ranges)) {
      const range = normalizePortRange(rangeState);
      if (!isRecord(rangeState) || !isPortBlockStart(rangeState.nextBase, range)) {
        fail(`Invalid Shipfox port lease registry: ${registryFile}`);
      }
      ranges[key] = {...range, nextBase: rangeState.nextBase};
    }
    return {version: 3, ranges, leases};
  } catch {
    fail(`Invalid Shipfox port lease registry: ${registryFile}`);
  }
}

function migrateLegacyPortLeaseRegistry(
  registry: Record<string, unknown>,
  registryFile: string,
): PortLeaseRegistry {
  if (!isRecord(registry.leases)) {
    fail(`Invalid Shipfox port lease registry: ${registryFile}`);
  }
  if (registry.version === 1) return migrateVersionOnePortLeaseRegistry(registry, registryFile);
  return migrateVersionTwoPortLeaseRegistry(registry, registryFile);
}

function migrateVersionOnePortLeaseRegistry(
  registry: Record<string, unknown>,
  registryFile: string,
): PortLeaseRegistry {
  if (!Number.isInteger(registry.nextBase))
    fail(`Invalid Shipfox port lease registry: ${registryFile}`);
  let range: PortRange;
  try {
    range = normalizePortRange(registry.range);
    if (!isPortBlockStart(registry.nextBase, range)) {
      fail(`Invalid Shipfox port lease registry: ${registryFile}`);
    }
  } catch {
    fail(`Invalid Shipfox port lease registry: ${registryFile}`);
  }
  return legacyRegistryToVersionThree(
    registry.leases as Record<string, unknown>,
    {
      [portRangeKey(range)]: {...range, nextBase: registry.nextBase},
    },
    registryFile,
  );
}

function migrateVersionTwoPortLeaseRegistry(
  registry: Record<string, unknown>,
  registryFile: string,
): PortLeaseRegistry {
  if (!isRecord(registry.ranges)) fail(`Invalid Shipfox port lease registry: ${registryFile}`);
  const ranges: PortLeaseRegistry['ranges'] = {};
  try {
    for (const [key, rangeState] of Object.entries(registry.ranges)) {
      const range = normalizePortRange(rangeState);
      if (
        !isRecord(rangeState) ||
        key !== portRangeKey(range) ||
        !isPortBlockStart(rangeState.nextBase, range)
      ) {
        fail(`Invalid Shipfox port lease registry: ${registryFile}`);
      }
      ranges[key] = {...range, nextBase: rangeState.nextBase};
    }
  } catch {
    fail(`Invalid Shipfox port lease registry: ${registryFile}`);
  }
  return legacyRegistryToVersionThree(
    registry.leases as Record<string, unknown>,
    ranges,
    registryFile,
  );
}

function legacyRegistryToVersionThree(
  legacyLeases: Record<string, unknown>,
  ranges: PortLeaseRegistry['ranges'],
  registryFile: string,
): PortLeaseRegistry {
  const leases: Record<string, PortLease> = {};
  for (const [legacyKey, lease] of Object.entries(legacyLeases)) {
    if (!isRecord(lease)) fail(`Invalid Shipfox port lease registry: ${registryFile}`);
    const range = normalizePortRange(lease.range ?? ranges[Object.keys(ranges)[0]]);
    if (!isPortBlockStart(lease.base, range))
      fail(`Invalid Shipfox port lease registry: ${registryFile}`);
    const workspacePath = typeof lease.workspacePath === 'string' ? lease.workspacePath : legacyKey;
    const workspaceId = legacyKey;
    const repositoryId = 'legacy';
    leases[portLeaseKey(repositoryId, workspaceId)] = {
      allocatedAt: String(lease.allocatedAt),
      base: lease.base,
      range,
      repositoryId,
      workspaceId,
      workspacePath,
    };
  }
  return {version: 3, ranges, leases};
}

function writePortLeaseRegistry(registry: PortLeaseRegistry, registryFile: string): void {
  mkdirSync(dirname(registryFile), {recursive: true});
  const tempFile = `${registryFile}.${process.pid}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(registry, null, 2)}\n`);
  renameSync(tempFile, registryFile);
}

function nextAvailablePortBlock(registry: PortLeaseRegistry, range: PortRange): number {
  const rangeState = ensurePortRange(registry, range);
  const leasedBlocks = Object.values(registry.leases);
  let candidate = rangeState.nextBase;
  const capacity = Math.floor((range.end - range.start + 1) / range.blockSize);

  for (let attempt = 0; attempt < capacity; attempt += 1) {
    if (
      isPortBlockStart(candidate, range) &&
      leasedBlocks.every((lease) => !portBlocksOverlap(candidate, range, lease.base, lease.range))
    ) {
      rangeState.nextBase = nextPortBlock(candidate, range);
      return candidate;
    }
    candidate = nextPortBlock(candidate, range);
  }
  fail(
    `Shipfox port lease range ${range.start}-${range.end} is exhausted. Run cleanup to remove stale leases.`,
  );
}

function ensurePortRange(
  registry: PortLeaseRegistry,
  range: PortRange,
): PortLeaseRegistry['ranges'][string] {
  const key = portRangeKey(range);
  registry.ranges[key] ??= {...range, nextBase: range.start};
  return registry.ranges[key];
}

function nextPortBlock(base: number, range: PortRange): number {
  const nextBase = base + range.blockSize;
  return nextBase + range.blockSize - 1 <= range.end ? nextBase : range.start;
}

function portBlocksOverlap(
  firstBase: number,
  firstRange: PortRange,
  secondBase: number,
  secondRange: PortRange,
): boolean {
  const firstEnd = firstBase + firstRange.blockSize - 1;
  const secondEnd = secondBase + secondRange.blockSize - 1;
  return firstBase <= secondEnd && secondBase <= firstEnd;
}

function isPortBlockStart(base: unknown, range: PortRange): base is number {
  return (
    Number.isInteger(base) &&
    base >= range.start &&
    base + range.blockSize - 1 <= range.end &&
    (base - range.start) % range.blockSize === 0
  );
}

function portRangeKey(range: PortRange): string {
  return `${range.start}-${range.end}-${range.blockSize}`;
}

function configuredPortValue(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!tcpPortPattern.test(normalized)) fail(`${name} must be an integer TCP port.`);
  return Number(normalized);
}

function normalizePortRange(range: unknown): PortRange {
  if (!isRecord(range)) fail('Shipfox port range must define start and end ports.');
  const start = Number(range.start);
  const end = Number(range.end);
  const blockSize = Number(range.blockSize ?? portBlockSize);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    !Number.isInteger(blockSize) ||
    start < 1 ||
    end > 65_535 ||
    end < start ||
    blockSize !== portBlockSize ||
    end - start + 1 < blockSize
  ) {
    fail(
      `Shipfox port range must be a valid TCP range with room for one ${portBlockSize}-port block.`,
    );
  }
  return {start, end, blockSize};
}

function validatePortDefinitions(definitions: StandardPortDefinitions): void {
  if (!definitions || typeof definitions !== 'object') fail('Port definitions must be an object.');
  for (const name of Object.keys(standardPorts) as StandardPortName[]) {
    const offset = definitions[name];
    if (!Number.isInteger(offset) || offset < 0) {
      fail(`Port definition ${name} must be a non-negative integer offset.`);
    }
  }
}

function releasePortLease(
  workspacePath: string,
  repositoryId: string,
  workspaceId: string,
  registryFile: string,
): void {
  withPortLeaseLock(() => {
    const registry = readPortLeaseRegistry(registryFile);
    delete registry.leases[portLeaseKey(repositoryId, workspaceId)];
    for (const [leaseId, lease] of Object.entries(registry.leases)) {
      if (
        lease.workspacePath === workspacePath &&
        lease.repositoryId === repositoryId &&
        lease.workspaceId === workspaceId
      ) {
        delete registry.leases[leaseId];
      }
    }
    writePortLeaseRegistry(registry, registryFile);
  }, registryFile);
}

function withPortLeaseLock<T>(callback: () => T, registryFile: string): T {
  const lockDirectory = resolve(dirname(registryFile), 'shipfox-port-leases.lock');
  mkdirSync(dirname(registryFile), {recursive: true});
  try {
    mkdirSync(lockDirectory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      fail(
        'Shipfox port lease registry is in use. Retry after the other workspace setup completes.',
      );
    }
    throw error;
  }
  try {
    return callback();
  } finally {
    rmdirSync(lockDirectory);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}
