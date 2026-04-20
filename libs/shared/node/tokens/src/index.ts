import {createHash, randomBytes} from 'node:crypto';
import {config} from './config.js';

const DISPLAY_PREFIX_LENGTH = 12;
const TOKEN_PREFIX_NAMESPACE = 'sf';
const UNQUALIFIED_TOKEN_PREFIX_RE = /^sf_(pr|rt|r|k|i|v)_/;
const QUALIFIED_TOKEN_PREFIX_RE = /^sf_([a-z0-9-]+)_(pr|rt|r|k|i|v)_/;

export const tokenTypeParts = {
  apiKey: 'k',
  invitation: 'i',
  emailVerification: 'v',
  passwordReset: 'pr',
  refreshToken: 'r',
  runnerToken: 'rt',
} as const;

export type TokenType = keyof typeof tokenTypeParts;
export type TokenEnvironment = 'production' | string;

export function generateOpaqueToken(type: TokenType): string {
  return `${getTokenPrefix(type)}${randomBytes(32).toString('base64url')}`;
}

export function hashOpaqueToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function getTokenType(raw: string): TokenType | undefined {
  const parsed = parseTokenPrefix(raw);
  if (!parsed || !matchesConfiguredTokenEnvironment(parsed.environment)) {
    return undefined;
  }

  const entry = Object.entries(tokenTypeParts).find(([, part]) => part === parsed.tokenTypePart);

  return entry?.[0] as TokenType | undefined;
}

export function getTokenEnvironment(raw: string): TokenEnvironment | undefined {
  const parsed = parseTokenPrefix(raw);
  if (!parsed || !matchesConfiguredTokenEnvironment(parsed.environment)) {
    return undefined;
  }

  return parsed.environment ?? 'production';
}

export function extractDisplayPrefix(raw: string): string {
  return raw.slice(0, DISPLAY_PREFIX_LENGTH);
}

function getTokenPrefix(type: TokenType): string {
  const environmentPart = getTokenEnvironmentPart();
  const tokenTypePart = tokenTypeParts[type];

  return environmentPart
    ? `${TOKEN_PREFIX_NAMESPACE}_${environmentPart}_${tokenTypePart}_`
    : `${TOKEN_PREFIX_NAMESPACE}_${tokenTypePart}_`;
}

function getTokenEnvironmentPart(): string | undefined {
  const environment = config.TOKEN_ENVIRONMENT?.trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');

  return environment || undefined;
}

function parseTokenPrefix(raw: string): {environment?: string; tokenTypePart: string} | undefined {
  const unqualifiedMatch = raw.match(UNQUALIFIED_TOKEN_PREFIX_RE);
  if (unqualifiedMatch?.[1]) {
    return {tokenTypePart: unqualifiedMatch[1]};
  }

  const qualifiedMatch = raw.match(QUALIFIED_TOKEN_PREFIX_RE);
  if (qualifiedMatch?.[1] && qualifiedMatch[2]) {
    return {environment: qualifiedMatch[1], tokenTypePart: qualifiedMatch[2]};
  }

  return undefined;
}

function matchesConfiguredTokenEnvironment(tokenEnvironment: string | undefined): boolean {
  const configuredEnvironment = getTokenEnvironmentPart();

  return configuredEnvironment ? tokenEnvironment === configuredEnvironment : true;
}
