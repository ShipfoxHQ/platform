import {createHash} from 'node:crypto';
import {
  IntegrationProviderError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-spi';
import {z} from 'zod';
import {GithubIntegrationProviderError} from '#core/errors.js';

export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
export const TOKEN_VALIDITY_BUFFER_MS = 60 * 1000;
export const TRANSIENT_BACKOFF_MIN_MS = 30 * 1000;
export const TRANSIENT_BACKOFF_MAX_MS = 5 * 60 * 1000;
export const TERMINAL_BACKOFF_MS = 15 * 60 * 1000;

const providerErrorReasons = [
  'repository-not-found',
  'installation-not-found',
  'file-not-found',
  'access-denied',
  'rate-limited',
  'timeout',
  'provider-unavailable',
  'provider-rejected',
  'malformed-provider-response',
  'content-too-large',
  'too-many-files',
] as const satisfies readonly IntegrationProviderErrorReason[];

const providerErrorReasonSchema = z.enum(providerErrorReasons);
const backoffErrorSchema = z.object({
  message: z.string(),
  status: z.number().int().optional(),
});
const terminalMintErrorReasons = new Set<IntegrationProviderErrorReason>([
  'access-denied',
  'installation-not-found',
  'provider-rejected',
  'malformed-provider-response',
]);

// Ref reasons describe ref-resolution failures, which a token mint never
// observes; keep them out of the envelope schema and acknowledge them here.
type MissingProviderErrorReason = Exclude<
  IntegrationProviderErrorReason,
  (typeof providerErrorReasons)[number] | 'ref-not-found' | 'ref-invalid'
>;
const providerErrorReasonSchemaCoversUnion: Record<MissingProviderErrorReason, never> = {};
void providerErrorReasonSchemaCoversUnion;

const installationTokenEnvelopeSchema = z.object({
  token: z.string().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
  permissions: z.record(z.string(), z.enum(['read', 'write', 'admin'])).optional(),
  backoffUntil: z.string().datetime().optional(),
  backoffReason: providerErrorReasonSchema.optional(),
  backoffError: backoffErrorSchema.optional(),
  // Stamped by the shared cache so a reader can verify an envelope was written for
  // the scope it is being served under (see readEnvelope).
  scopeKey: z.string().optional(),
});

export interface InstallationTokenEnvelope {
  token?: string | undefined;
  expiresAt?: Date | undefined;
  permissions?: Record<string, 'read' | 'write' | 'admin'> | undefined;
  backoffUntil?: Date | undefined;
  backoffReason?: IntegrationProviderErrorReason | undefined;
  backoffError?:
    | {
        message: string;
        status?: number | undefined;
      }
    | undefined;
  scopeKey?: string | undefined;
}

export type MintErrorClass = 'transient' | 'terminal';

export interface ClassifiedMintError {
  class: MintErrorClass;
  reason: IntegrationProviderErrorReason;
  retryAfterSeconds?: number | undefined;
}

export interface GithubInstallationTokenScope {
  repositoryId: number;
  permissions: Record<string, 'read' | 'write'>;
}

export function githubInstallationTokenScopeKey(scope: GithubInstallationTokenScope): string {
  const permissions = Object.entries(scope.permissions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([permission, access]) => `${permission}-${access}`)
    .join('_');
  return permissions.length === 0
    ? `${scope.repositoryId}`
    : `${scope.repositoryId}/${permissions}`;
}

export function githubInstallationTokenNamespace(
  installationId: number,
  scopeKey?: string | undefined,
): string {
  // Scoped tokens live under a child namespace so a scoped request is never served
  // the installation-wide token envelope (and vice versa). The scope key is derived
  // from caller-supplied permission names, so the namespace embeds a deterministic
  // bounded hash of it instead: the fixed-length [0-9a-f] component always satisfies
  // the secrets namespace pattern and 128-character cap no matter how many
  // permissions a scope carries, and crafted permission names cannot collide onto
  // one secret slot. Uninstall cleanup deliberately only removes the broad envelope
  // — scoped envelopes hold short-lived, self-expiring tokens.
  return scopeKey === undefined
    ? `system/github/installation-token/${installationId}`
    : `system/github/installation-token/${installationId}/scope/${githubInstallationTokenScopeHash(scopeKey)}`;
}

export function githubInstallationTokenScopeHash(scopeKey: string): string {
  // SHA-256: deterministic across processes so every tier derives the same
  // namespace for one scope, and collision-resistant so two distinct scopes can
  // never share a secret slot (a 32-bit FNV-1a hash could collide and turn
  // scoped-token lookups into repeated GitHub mints). The lowercase hex digest
  // keeps the namespace within the secrets pattern and 128-character cap.
  return createHash('sha256').update(scopeKey).digest('hex');
}

export function encodeInstallationTokenEnvelope(envelope: InstallationTokenEnvelope): string {
  return JSON.stringify({
    ...(envelope.token !== undefined && {token: envelope.token}),
    ...(envelope.expiresAt !== undefined && {expiresAt: envelope.expiresAt.toISOString()}),
    ...(envelope.permissions !== undefined && {permissions: envelope.permissions}),
    ...(envelope.backoffUntil !== undefined && {
      backoffUntil: envelope.backoffUntil.toISOString(),
    }),
    ...(envelope.backoffReason !== undefined && {backoffReason: envelope.backoffReason}),
    ...(envelope.backoffError !== undefined && {backoffError: envelope.backoffError}),
    ...(envelope.scopeKey !== undefined && {scopeKey: envelope.scopeKey}),
  });
}

export function parseInstallationTokenEnvelope(raw: string): InstallationTokenEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const result = installationTokenEnvelopeSchema.safeParse(parsed);
  if (!result.success) return undefined;

  return {
    token: result.data.token,
    expiresAt: result.data.expiresAt ? new Date(result.data.expiresAt) : undefined,
    permissions: result.data.permissions,
    backoffUntil: result.data.backoffUntil ? new Date(result.data.backoffUntil) : undefined,
    backoffReason: result.data.backoffReason,
    backoffError: result.data.backoffError,
    scopeKey: result.data.scopeKey,
  };
}

export function usable(
  envelope: InstallationTokenEnvelope | undefined,
  now: Date,
): envelope is InstallationTokenEnvelope & {token: string; expiresAt: Date} {
  return (
    envelope?.token !== undefined &&
    envelope.expiresAt !== undefined &&
    !needsRefresh(envelope.expiresAt, now)
  );
}

export function needsRefresh(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime() + TOKEN_REFRESH_MARGIN_MS;
}

export function stillValid(expiresAt: Date | undefined, now: Date): boolean {
  return expiresAt !== undefined && expiresAt.getTime() > now.getTime() + TOKEN_VALIDITY_BUFFER_MS;
}

export function backoffActive(envelope: InstallationTokenEnvelope | undefined, now: Date): boolean {
  return (
    envelope?.backoffUntil !== undefined &&
    envelope.backoffReason !== undefined &&
    envelope.backoffUntil.getTime() > now.getTime()
  );
}

export function classifyMintError(error: unknown): ClassifiedMintError {
  if (error instanceof IntegrationProviderError) {
    return {
      reason: error.reason,
      retryAfterSeconds: error.retryAfterSeconds,
      class: mintErrorClassForReason(error.reason),
    };
  }

  return {reason: 'provider-unavailable', class: 'transient'};
}

export function mintErrorClassForReason(reason: IntegrationProviderErrorReason): MintErrorClass {
  return terminalMintErrorReasons.has(reason) ? 'terminal' : 'transient';
}

export function backoffMs(classified: ClassifiedMintError): number {
  if (classified.class === 'terminal') return TERMINAL_BACKOFF_MS;

  const retryAfterMs = (classified.retryAfterSeconds ?? 0) * 1000;
  return Math.min(TRANSIENT_BACKOFF_MAX_MS, Math.max(TRANSIENT_BACKOFF_MIN_MS, retryAfterMs));
}

export function providerErrorFromBackoff(
  reason: IntegrationProviderErrorReason,
  retryAfterMs: number,
  backoffError?: InstallationTokenEnvelope['backoffError'],
): GithubIntegrationProviderError {
  return new GithubIntegrationProviderError(
    reason,
    backoffError?.message ?? `GitHub installation token mint is backed off after ${reason}`,
    Math.max(1, Math.ceil(retryAfterMs / 1000)),
    backoffError?.status,
  );
}

export function toProviderError(error: unknown): GithubIntegrationProviderError {
  if (error instanceof GithubIntegrationProviderError) return error;
  if (error instanceof IntegrationProviderError) {
    return new GithubIntegrationProviderError(
      error.reason,
      error.message,
      error.retryAfterSeconds,
      error.status,
    );
  }
  return new GithubIntegrationProviderError(
    'provider-unavailable',
    error instanceof Error ? error.message : 'GitHub installation token mint failed',
  );
}
