#!/usr/bin/env node

import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  assertCredentialSocketTimeout,
  requestCredentialSocketTransport,
} from '@shipfox/runner-workspace';
import {
  CLAUDE_CREDENTIAL_CAPABILITY_ENV,
  CLAUDE_CREDENTIAL_HELPER_TIMEOUT_MS,
  CLAUDE_CREDENTIAL_SOCKET_ENV,
  CLAUDE_CREDENTIAL_TIMEOUT_ENV,
} from '#core/claude-credential-broker.js';

export const CLAUDE_AUTH_HELPER_PATH = fileURLToPath(
  new URL('./claude-auth-helper.js', import.meta.url),
);

interface WritableOutput {
  write(chunk: string): unknown;
}

export async function runClaudeAuthHelper(params?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly output?: WritableOutput;
}): Promise<void> {
  const env = params?.env ?? process.env;
  const socketPath = requiredEnvironment(env, CLAUDE_CREDENTIAL_SOCKET_ENV);
  const capability = requiredEnvironment(env, CLAUDE_CREDENTIAL_CAPABILITY_ENV);
  const timeoutMs = helperTimeout(env[CLAUDE_CREDENTIAL_TIMEOUT_ENV]);
  const response = await requestCredentialSocketTransport(
    socketPath,
    {capability, operation: 'get'},
    {timeoutMs, shouldRetry: () => false},
  );
  if (!response.ok || typeof response.token !== 'string' || response.token.length === 0) {
    throw new Error('Claude credential broker rejected the request');
  }

  (params?.output ?? process.stdout).write(`${response.token}\n`);
}

export async function main(params?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly output?: WritableOutput;
  readonly stderr?: WritableOutput;
  readonly setExitCode?: (code: number) => void;
}): Promise<void> {
  try {
    await runClaudeAuthHelper(params);
  } catch (error) {
    (params?.setExitCode ?? ((code: number) => (process.exitCode = code)))(1);
    (params?.stderr ?? process.stderr).write(
      `claude-auth-helper failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`,
    );
  }
}

function requiredEnvironment(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Claude credential helper environment is missing ${name}`);
  }
  return value;
}

function helperTimeout(rawValue: string | undefined): number {
  if (rawValue === undefined) return CLAUDE_CREDENTIAL_HELPER_TIMEOUT_MS;
  const value = Number(rawValue);
  try {
    assertCredentialSocketTimeout(value);
  } catch {
    throw new Error('Claude credential helper timeout is invalid');
  }
  return value;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && resolve(entrypoint) === CLAUDE_AUTH_HELPER_PATH) {
  await main();
}
