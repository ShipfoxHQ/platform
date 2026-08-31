import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {
  createWorktreeServices,
  defineWorktreeServices,
  findStalePortLeases,
  removeStalePortLeases,
  type WorktreeEnvironment,
  type WorktreeServicesConfig,
  type WorktreeServicesOptions,
} from './index.js';

const commands = new Set(['up', 'stop', 'status', 'destroy', 'cleanup']);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export async function main(args: readonly string[]): Promise<void> {
  const parsed = parseArgs(args);
  const registryFile = resolveRegistryFile(parsed.env);

  if (parsed.command === 'cleanup') {
    const staleLeases = findStalePortLeases({registryFile});
    if (staleLeases.length === 0) {
      process.stdout.write('No stale Shipfox port leases found.\n');
      return;
    }
    for (const lease of staleLeases) {
      process.stdout.write(
        `${lease.workspacePath} (${lease.base}-${lease.base + lease.range.blockSize - 1})\n`,
      );
    }
    if (parsed.apply) {
      removeStalePortLeases(staleLeases, {registryFile});
      process.stdout.write(`Removed ${staleLeases.length} stale Shipfox port lease(s).\n`);
    } else {
      process.stdout.write(
        `Found ${staleLeases.length} stale Shipfox port lease(s). Run cleanup --apply to remove them.\n`,
      );
    }
    return;
  }

  const workspacePath = resolve(parsed.workspacePath ?? process.cwd());
  const rootPath = parsed.rootPath ?? parsed.env.CONDUCTOR_ROOT_PATH;
  const configPath = resolveConfigPath(parsed.configPath, workspacePath, rootPath);
  const module = await import(pathToFileURL(configPath).href);
  const config = defineWorktreeServices(module.default as WorktreeServicesConfig);
  const options: WorktreeServicesOptions = {env: parsed.env, registryFile, workspacePath};
  if (rootPath) options.rootPath = rootPath;
  const services = createWorktreeServices(config, options);
  services[parsed.command]();
}

interface ParsedArgs {
  apply: boolean;
  command: 'cleanup' | 'destroy' | 'status' | 'stop' | 'up';
  configPath?: string;
  env: WorktreeEnvironment;
  rootPath?: string;
  workspacePath?: string;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const [command, ...rest] = args;
  if (!command || !commands.has(command)) usage();
  let apply = false;
  let configPath: string | undefined;
  let rootPath: string | undefined;
  let workspacePath: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--apply') {
      if (command !== 'cleanup') usage();
      apply = true;
      continue;
    }
    const value = parsePathArgument(argument, rest[index + 1]);
    index += 1;
    if (argument === '--config') configPath = value;
    if (argument === '--root') rootPath = value;
    if (argument === '--workspace') workspacePath = value;
  }
  return {
    apply,
    command: command as ParsedArgs['command'],
    configPath,
    env: process.env,
    rootPath,
    workspacePath,
  };
}

function parsePathArgument(argument: string | undefined, value: string | undefined): string {
  if (argument !== '--config' && argument !== '--root' && argument !== '--workspace') usage();
  if (!value) usage();
  return value;
}

function resolveConfigPath(
  configPath: string | undefined,
  workspacePath: string,
  rootPath: string | undefined,
): string {
  if (configPath) return resolve(workspacePath, configPath);
  const workspaceConfig = resolve(workspacePath, 'dev/worktree-services.config.mjs');
  if (existsSync(workspaceConfig)) return workspaceConfig;
  if (rootPath) {
    const rootConfig = resolve(rootPath, 'dev/worktree-services.config.mjs');
    if (existsSync(rootConfig)) return rootConfig;
  }
  throw new Error(
    `Missing ${workspaceConfig}. Create a dev/worktree-services.config.mjs file or pass --config.`,
  );
}

function resolveRegistryFile(env: WorktreeEnvironment): string {
  return resolve(
    env.SHIPFOX_PORT_LEASES_FILE ?? resolve(homedir(), '.shipfox/shipfox-port-leases.json'),
  );
}

function usage(): never {
  throw new Error(
    'Usage: shipfox-worktree-services <up|stop|status|destroy|cleanup [--apply]> [--workspace path] [--root path] [--config path]',
  );
}
