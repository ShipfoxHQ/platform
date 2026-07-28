import {readFileSync} from 'node:fs';
import type {AgentSessionRecord} from '#core/session/session-record.js';

export interface ClaudeSystemSubtypeFixture {
  package: string;
  version: string;
  subtypes: string[];
}

const SDK_ENTRY_URL = import.meta.resolve('@anthropic-ai/claude-agent-sdk');
const SDK_TYPES_URL = new URL('./sdk.d.ts', SDK_ENTRY_URL);

export function readClaudeSessionFixture(name: string): AgentSessionRecord[] {
  const contents = readFileSync(
    new URL(`./claude-session/${name}`, import.meta.url),
    'utf8',
  ).trim();

  return contents.split('\n').map((data, index) => ({data, ts: index + 1}));
}

export function readClaudeSystemSubtypeFixture(): ClaudeSystemSubtypeFixture {
  const contents = readFileSync(
    new URL('./claude-session/sdk-system-subtypes.json', import.meta.url),
    'utf8',
  );
  return JSON.parse(contents) as ClaudeSystemSubtypeFixture;
}

export function readInstalledClaudeSdkVersion(): string {
  const contents = readFileSync(new URL('./package.json', SDK_TYPES_URL), 'utf8');
  const packageJson = JSON.parse(contents) as {version?: unknown};
  if (typeof packageJson.version !== 'string') {
    throw new Error('The installed Claude SDK package has no version');
  }
  return packageJson.version;
}

export function readInstalledClaudeSystemSubtypes(): string[] {
  const declaration = readFileSync(SDK_TYPES_URL, 'utf8');
  return [...declaration.matchAll(/type: 'system';\s+subtype: '([^']+)'/g)]
    .map((match) => match[1])
    .filter((subtype): subtype is string => subtype !== undefined)
    .sort();
}
