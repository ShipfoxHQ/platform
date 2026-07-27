import {basename} from 'node:path';
import type {
  AgentSessionRuntimeDiagnostic,
  LoadExtensionsResult,
} from '@earendil-works/pi-coding-agent';
import type {AgentConfigIssueDto} from '@shipfox/api-workflows-dto';

const HARNESS_ERROR_PREFIX = 'Pi extension setup failed: ';
const HARNESS_DIAGNOSTIC_MAX_LENGTH = 200;
const PATH_PATTERN = /(?:file:\/\/)?\//g;
const PATH_PREFIX_CHARACTER_PATTERN = /[A-Za-z0-9._~+@%]/;
const NETWORK_URL_PATTERN = /(?:https?|ssh):\/{0,2}$/;
const ABSOLUTE_PATH_FIRST_CHARACTER_PATTERN = /[\\/^*?()[\]{}]/;
const WHITESPACE_PATTERN = /\s/;
const PATH_EXTENSION_PATTERN = /\.[A-Za-z0-9]+$/;
const TRAILING_PATH_PUNCTUATION_PATTERN = /[.,;:]+$/;
const TRUNCATION_TOKEN_PATTERN = /\s[^\s]*$/;

/**
 * A user-fixable agent-step configuration failure: an unknown provider, a
 * provider/model pair pi does not know, or workspace provider credentials that
 * are missing or incomplete. The step layer translates this to the
 * `agent_config_invalid` reason, distinct from a genuine provider/API failure
 * (`agent_invocation_failed`).
 */
export class AgentConfigError extends Error {
  constructor(
    message: string,
    public readonly agentConfigIssue: AgentConfigIssueDto,
  ) {
    super(message);
    this.name = 'AgentConfigError';
  }
}

export interface AgentHarnessEnvironment {
  readonly cwd: string;
  readonly provider: string;
  readonly model: string;
  readonly thinking: string;
  readonly extensionPaths: readonly string[];
  readonly resolvedExtensionPaths?: readonly string[];
}

export type AgentHarnessResourceLoaderError = LoadExtensionsResult['errors'][number];

export interface AgentHarnessResourceLoaderFailure {
  readonly error: AgentHarnessResourceLoaderError;
  readonly directory: string;
}

/** Removes filesystem prefixes from user-visible harness diagnostics without rewriting syntax. */
function sanitizeHarnessDiagnosticMessage(messages: readonly string[]): string {
  const sanitizedMessages = messages
    .filter((diagnostic) => diagnostic.trim().length > 0)
    .map(sanitizeDiagnosticMessage)
    .filter((message, index, allMessages) => allMessages.indexOf(message) === index);
  const message = sanitizedMessages.join('; ');

  if (message.length <= HARNESS_DIAGNOSTIC_MAX_LENGTH) return message;

  const marker = '…';
  const candidate = sliceWithoutLoneSurrogate(
    message,
    HARNESS_DIAGNOSTIC_MAX_LENGTH - marker.length,
  );
  const boundary = candidate.search(TRUNCATION_TOKEN_PATTERN);
  const discardedTailLength = boundary > 0 ? candidate.length - boundary : 0;
  const truncated =
    boundary > 0 && discardedTailLength <= Math.floor(candidate.length / 2)
      ? candidate.slice(0, boundary)
      : candidate;
  return `${truncated.trimEnd()}${marker}`;
}

function sanitizeDiagnosticMessage(message: string): string {
  let cursor = 0;
  let sanitized = '';

  for (const match of message.matchAll(PATH_PATTERN)) {
    const matchStart = match.index;
    if (matchStart < cursor) continue;

    const prefix = match[0].startsWith('file://') ? 'file://' : '';
    const pathStart = matchStart + prefix.length;
    const previousCharacter = message[pathStart - 1];

    if (
      (previousCharacter !== undefined && PATH_PREFIX_CHARACTER_PATTERN.test(previousCharacter)) ||
      isFileUrlSlash(message, pathStart) ||
      isNetworkUrlSlash(message, pathStart) ||
      !isLikelyAbsolutePath(message, pathStart)
    ) {
      continue;
    }

    const pathEnd = findAbsolutePathEnd(message, pathStart);
    if (pathEnd <= pathStart + 1) continue;

    const path = message.slice(pathStart, pathEnd);
    sanitized += message.slice(cursor, matchStart);
    sanitized += `${prefix}${path.slice(path.lastIndexOf('/') + 1)}`;
    cursor = pathEnd;
  }

  return sanitized + message.slice(cursor);
}

function isFileUrlSlash(message: string, pathStart: number): boolean {
  const precedingText = message.slice(Math.max(0, pathStart - 6), pathStart);
  return precedingText.endsWith('file:') || precedingText.endsWith('file:/');
}

function isNetworkUrlSlash(message: string, pathStart: number): boolean {
  const protocolPrefix = message.slice(Math.max(0, pathStart - 8), pathStart + 1);
  return NETWORK_URL_PATTERN.test(protocolPrefix);
}

function isLikelyAbsolutePath(message: string, pathStart: number): boolean {
  const firstPathCharacter = message[pathStart + 1];
  return (
    firstPathCharacter !== undefined &&
    !ABSOLUTE_PATH_FIRST_CHARACTER_PATTERN.test(firstPathCharacter)
  );
}

function findAbsolutePathEnd(message: string, pathStart: number): number {
  for (let index = pathStart + 1; index < message.length; index += 1) {
    const character = message[index];

    if (isPathTerminator(character)) return index;

    if ((character === ',' || character === ':') && message[index + 1] === '/') return index;

    if (character !== undefined && WHITESPACE_PATTERN.test(character)) {
      const nextCharacter = skipWhitespace(message, index);
      const nextSegmentEnd = findNextPathTerminator(message, nextCharacter);
      const nextSegment = message.slice(nextCharacter, nextSegmentEnd);
      const continuesPath =
        nextSegment.includes('/') ||
        PATH_EXTENSION_PATTERN.test(nextSegment.replace(TRAILING_PATH_PUNCTUATION_PATTERN, ''));

      if (!continuesPath) return index;
    }
  }

  return message.length;
}

function skipWhitespace(message: string, start: number): number {
  let index = start;
  while (index < message.length && WHITESPACE_PATTERN.test(message[index] ?? '')) index += 1;
  return index;
}

function findNextPathTerminator(message: string, start: number): number {
  for (let index = start; index < message.length; index += 1) {
    if (isPathTerminator(message[index])) return index;
  }
  return message.length;
}

function isPathTerminator(character: string | undefined): boolean {
  return (
    character === '\n' ||
    character === '\r' ||
    character === '`' ||
    character === '"' ||
    character === "'" ||
    character === '<' ||
    character === '>' ||
    character === '|' ||
    character === '(' ||
    character === ')' ||
    character === '[' ||
    character === ']' ||
    character === '{' ||
    character === '}' ||
    character === ';'
  );
}

function sliceWithoutLoneSurrogate(value: string, length: number): string {
  const candidate = value.slice(0, length);
  const lastCodeUnit = candidate.charCodeAt(candidate.length - 1);
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff ? candidate.slice(0, -1) : candidate;
}

export class AgentHarnessUnavailableError extends Error {
  public readonly diagnostics: readonly AgentSessionRuntimeDiagnostic[];
  public readonly environment: AgentHarnessEnvironment;
  public readonly missingExtensionDirectories: readonly string[];
  public readonly resourceLoaderErrors: readonly AgentHarnessResourceLoaderFailure[];

  constructor({
    diagnostics,
    environment,
    missingExtensionDirectories = [],
    resourceLoaderErrors = [],
  }: {
    diagnostics: readonly AgentSessionRuntimeDiagnostic[];
    environment: AgentHarnessEnvironment;
    missingExtensionDirectories?: readonly string[];
    resourceLoaderErrors?: readonly AgentHarnessResourceLoaderFailure[];
  }) {
    const missingDirectories = missingExtensionDirectories.filter(
      (directory) => !resourceLoaderErrors.some((failure) => failure.directory === directory),
    );
    const loaderMessages = resourceLoaderErrors.map(({error, directory}) => {
      const message = error.error;
      const sanitizedMessage = sanitizeDiagnosticMessage(message);
      const extensionName = basename(directory);
      return extensionName !== '' && !sanitizedMessage.includes(extensionName)
        ? `${extensionName}: ${message}`
        : message;
    });
    const extensionMessages = [
      ...(missingDirectories.length === 0
        ? []
        : [`Pi extensions failed to load from: ${missingDirectories.join(', ')}`]),
      ...loaderMessages,
    ];
    const diagnosticMessages = diagnostics
      .filter((diagnostic) => diagnostic.type === 'error')
      .map((diagnostic) => diagnostic.message);
    const detail = sanitizeHarnessDiagnosticMessage([...extensionMessages, ...diagnosticMessages]);
    super(`${HARNESS_ERROR_PREFIX}${detail || 'The runner harness could not start.'}`);
    this.name = 'AgentHarnessUnavailableError';
    this.diagnostics = diagnostics;
    this.environment = environment;
    this.missingExtensionDirectories = missingExtensionDirectories;
    this.resourceLoaderErrors = resourceLoaderErrors;
  }
}

export class AgentInvocationError extends Error {
  constructor(
    message: string,
    public readonly response: string | undefined,
  ) {
    super(message);
    this.name = 'AgentInvocationError';
  }
}

export class AgentPermissionModeError extends Error {
  constructor(
    public readonly requested: string,
    public readonly observed: string,
  ) {
    super(
      `Claude agent permission mode was downgraded: requested "${requested}", observed "${observed}".`,
    );
    this.name = 'AgentPermissionModeError';
  }
}
