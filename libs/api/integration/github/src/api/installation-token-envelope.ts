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
export const GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT = 'compatibility';
export const GITHUB_INSTALLATION_TOKEN_BACKOFF_KEY = 'BACKOFF';
export const GITHUB_LEGACY_INSTALLATION_TOKEN_KEY = 'envelope';

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
}

export type MintErrorClass = 'transient' | 'terminal';

export interface ClassifiedMintError {
  class: MintErrorClass;
  reason: IntegrationProviderErrorReason;
  retryAfterSeconds?: number | undefined;
}

export const GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY = 'ENVELOPE';

export type GithubInstallationTokenPermissions = Record<string, 'read' | 'write'>;

export function githubInstallationTokenNamespace(installationId: number): string {
  return `system/github/installation-token/${installationId}`;
}

export function githubInstallationTokenKey(permissionFingerprint: string): string {
  if (permissionFingerprint.length === 0) {
    throw new Error('GitHub installation token permission fingerprint cannot be empty');
  }

  return `TOKEN_${createHash('sha256').update(permissionFingerprint, 'utf8').digest('hex').toUpperCase()}`;
}

export function githubInstallationTokenBackoffKey(permissionFingerprint: string): string {
  if (permissionFingerprint === GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT) {
    return GITHUB_INSTALLATION_TOKEN_BACKOFF_KEY;
  }

  return `BACKOFF_${githubInstallationTokenKey(permissionFingerprint).slice('TOKEN_'.length)}`;
}

export function githubInstallationTokenPermissionFingerprint(
  permissions: Readonly<GithubInstallationTokenPermissions>,
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(permissions).sort(([first], [second]) => {
        if (first < second) return -1;
        if (first > second) return 1;
        return 0;
      }),
    ),
  );
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
