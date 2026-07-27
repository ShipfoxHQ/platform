import {basename} from 'node:path';
import type {
  AgentSessionRuntimeDiagnostic,
  LoadExtensionsResult,
} from '@earendil-works/pi-coding-agent';
import {type AgentConfigIssueDto, STEP_ERROR_MESSAGE_MAX_LENGTH} from '@shipfox/api-workflows-dto';

const HARNESS_ERROR_PREFIX = 'Pi extension setup failed: ';
const HARNESS_DIAGNOSTIC_MAX_LENGTH = STEP_ERROR_MESSAGE_MAX_LENGTH - HARNESS_ERROR_PREFIX.length;
const PATH_PATTERN =
  /(?<![A-Za-z0-9._~+@%])((?:file:\/\/)?\/(?:[A-Za-z0-9._~+@%=-]+\/)*[A-Za-z0-9._~+@%=-]+)/g;
const URL_PATTERN = /(?:https?|ssh):\/\//;
const TRUNCATION_TOKEN_PATTERN = /\s[^\s]*$/;
const WHITESPACE_PATTERN = /(\s+)/;

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
  return message
    .split(WHITESPACE_PATTERN)
    .map((token) => (URL_PATTERN.test(token) ? token : sanitizeDiagnosticToken(token)))
    .join('');
}

function sliceWithoutLoneSurrogate(value: string, length: number): string {
  const candidate = value.slice(0, length);
  const lastCodeUnit = candidate.charCodeAt(candidate.length - 1);
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff ? candidate.slice(0, -1) : candidate;
}

function sanitizeDiagnosticToken(token: string): string {
  return token.replace(PATH_PATTERN, (_match, path: string) =>
    path.startsWith('file://')
      ? `file://${path.slice(path.lastIndexOf('/') + 1)}`
      : path.slice(path.lastIndexOf('/') + 1),
  );
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
