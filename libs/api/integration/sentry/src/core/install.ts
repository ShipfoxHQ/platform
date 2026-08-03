import {createHash, timingSafeEqual} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {SentryApiClient, SentryAuthorization} from '#api/client.js';
import {
  SentryClaimProofMismatchError,
  SentryInstallationAlreadyLinkedError,
  SentryInstallationDeletedError,
  SentryIntegrationProviderError,
  SentryVerificationInProgressError,
} from '#core/errors.js';
import type {
  PersistVerifiedUnclaimedInstallationParams,
  SentryInstallation,
} from '#db/installations.js';

export interface ConnectSentryInstallationInput {
  workspaceId: string;
  installationUuid: string;
  orgSlug: string;
  displayName: string;
  installerUserId: string;
  codeHash: string;
}

// sha256 of the single-use authorization code. Stored on the install row so the
// claim can prove the claimant holds the same code Sentry issued, without ever
// persisting a live credential (the code is dead once exchanged).
export function hashAuthorizationCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// Constant-time compare of two sha256 hex digests, matching the HMAC check in
// signature.ts. The length guard runs first because timingSafeEqual throws on a
// length mismatch, and a digest's length is not secret.
function codeHashesEqual(presented: string, stored: string): boolean {
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(stored));
}

export interface VerifyAndPersistUnclaimedInstallationParams {
  sentry: SentryApiClient;
  installationUuid: string;
  code: string;
  // Known from the signed webhook payload; omit to derive it from Sentry after
  // the exchange (the browser-first claim carries no payload).
  orgSlug?: string | undefined;
  verifyInstall: boolean;
  persistVerifiedUnclaimedInstallation: (
    input: PersistVerifiedUnclaimedInstallationParams,
  ) => Promise<SentryInstallation>;
}

export interface VerifyAndPersistUnclaimedInstallationResult {
  installation: SentryInstallation;
  authorization: SentryAuthorization;
}

/**
 * Security-critical exchange → persist → best-effort verify, shared by the signed
 * webhook and the browser-first claim. The exchange is the authenticity check and
 * spends the single-use code, so it runs OUTSIDE any DB transaction; the caller's
 * `persistVerifiedUnclaimedInstallation` owns the short transaction. The verify
 * runs AFTER the row is durably persisted, so a verify failure leaves a claimable
 * row rather than a Sentry-side "installed" state pointing at a row that was never
 * written. Never logs the raw code.
 */
export async function verifyAndPersistUnclaimedInstallation(
  params: VerifyAndPersistUnclaimedInstallationParams,
): Promise<VerifyAndPersistUnclaimedInstallationResult> {
  const authorization = await params.sentry.exchangeAuthorizationCode({
    installationUuid: params.installationUuid,
    code: params.code,
  });

  const orgSlug =
    params.orgSlug ??
    (
      await params.sentry.getInstallation({
        installationUuid: params.installationUuid,
        token: authorization.token,
      })
    ).orgSlug;

  const installation = await params.persistVerifiedUnclaimedInstallation({
    installationUuid: params.installationUuid,
    orgSlug,
    codeHash: hashAuthorizationCode(params.code),
  });

  if (params.verifyInstall) {
    await verifySentryInstallationBestEffort({
      sentry: params.sentry,
      installationUuid: params.installationUuid,
      token: authorization.token,
    });
  }

  return {installation, authorization};
}

export interface HandleSentryConnectParams {
  sentry: SentryApiClient;
  workspaceId: string;
  code: string;
  installationUuid: string;
  installerUserId: string;
  verifyInstall: boolean;
  getSentryInstallation: (input: {
    installationUuid: string;
  }) => Promise<SentryInstallation | undefined>;
  getConnectionById: (id: string) => Promise<IntegrationConnection<'sentry'> | undefined>;
  connectSentryInstallation: (
    input: ConnectSentryInstallationInput,
  ) => Promise<IntegrationConnection<'sentry'>>;
  persistVerifiedUnclaimedInstallation: (
    input: PersistVerifiedUnclaimedInstallationParams,
  ) => Promise<SentryInstallation>;
}

/**
 * Binds a verified Sentry installation to a workspace (the claim half of the
 * webhook-authoritative flow). The webhook persists the verified-unclaimed row;
 * this proves the claimant controls the install and sets `connection_id`.
 *
 * Proof rules (unified claim auth):
 * - exchange succeeds → browser-first winner or a re-entry with a fresh code.
 * - exchange "already used" + the presented code hashes to the stored hash →
 *   the same code the webhook spent, so the claimant holds it (same-code race).
 * - exchange "already used" + the verified row is not visible yet → a concurrent
 *   webhook is mid-exchange; retryable so the client backoff reconciles.
 * - anything else on an existing unclaimed row → proof mismatch (403, IDOR gate).
 */
export async function handleSentryConnect(
  params: HandleSentryConnectParams,
): Promise<IntegrationConnection<'sentry'>> {
  const install = await params.getSentryInstallation({installationUuid: params.installationUuid});

  if (install) {
    if (install.status === 'deleted') {
      throw new SentryInstallationDeletedError(params.installationUuid);
    }
    if (install.connectionId) {
      return resolveClaimedInstall(params, install.connectionId);
    }
    if (!isVerifiedUnclaimed(install)) {
      throw new SentryVerificationInProgressError(params.installationUuid);
    }
    return claimVerifiedInstall(params, install);
  }

  return claimBrowserFirst(params);
}

async function resolveClaimedInstall(
  params: HandleSentryConnectParams,
  connectionId: string,
): Promise<IntegrationConnection<'sentry'>> {
  const connection = await params.getConnectionById(connectionId);
  if (connection && connection.workspaceId === params.workspaceId) {
    return connection;
  }
  throw new SentryInstallationAlreadyLinkedError(params.installationUuid);
}

async function claimVerifiedInstall(
  params: HandleSentryConnectParams,
  install: VerifiedUnclaimedSentryInstallation,
): Promise<IntegrationConnection<'sentry'>> {
  let authorization: SentryAuthorization;
  try {
    authorization = await params.sentry.exchangeAuthorizationCode({
      installationUuid: params.installationUuid,
      code: params.code,
    });
  } catch (error) {
    if (isCodeAlreadyUsed(error)) {
      if (
        install.codeHash &&
        codeHashesEqual(hashAuthorizationCode(params.code), install.codeHash)
      ) {
        return bindClaim(params, {orgSlug: install.orgSlug, codeHash: install.codeHash});
      }
      throw new SentryClaimProofMismatchError(params.installationUuid);
    }
    throw error;
  }

  const connection = await bindClaim(params, {
    orgSlug: install.orgSlug,
    codeHash: hashAuthorizationCode(params.code),
  });
  if (params.verifyInstall) {
    await verifySentryInstallationBestEffort({
      sentry: params.sentry,
      installationUuid: params.installationUuid,
      token: authorization.token,
      connectionId: connection.id,
    });
  }
  return connection;
}

async function claimBrowserFirst(
  params: HandleSentryConnectParams,
): Promise<IntegrationConnection<'sentry'>> {
  let result: VerifyAndPersistUnclaimedInstallationResult;
  try {
    result = await verifyAndPersistUnclaimedInstallation({
      sentry: params.sentry,
      installationUuid: params.installationUuid,
      code: params.code,
      verifyInstall: false,
      persistVerifiedUnclaimedInstallation: params.persistVerifiedUnclaimedInstallation,
    });
  } catch (error) {
    if (isCodeAlreadyUsed(error)) {
      return reconcileConcurrentClaim(params);
    }
    throw error;
  }

  const connection = await bindClaim(params, {
    orgSlug: result.installation.orgSlug,
    codeHash: hashAuthorizationCode(params.code),
  });
  if (params.verifyInstall) {
    await verifySentryInstallationBestEffort({
      sentry: params.sentry,
      installationUuid: params.installationUuid,
      token: result.authorization.token,
      connectionId: connection.id,
    });
  }
  return connection;
}

// The browser-first exchange got "already used" with no row visible at lookup: a
// concurrent webhook won the exchange. Re-read once: if its verified row is now
// visible we reconcile through the same proof rules; if it got claimed we resolve
// it; if it was tombstoned we surface that terminally (matching the top-level
// check); otherwise it is still mid-flight, so the claim is retryable.
async function reconcileConcurrentClaim(
  params: HandleSentryConnectParams,
): Promise<IntegrationConnection<'sentry'>> {
  const reread = await params.getSentryInstallation({installationUuid: params.installationUuid});
  if (reread?.status === 'deleted') {
    throw new SentryInstallationDeletedError(params.installationUuid);
  }
  if (reread) {
    if (reread.connectionId) {
      return resolveClaimedInstall(params, reread.connectionId);
    }
    if (isVerifiedUnclaimed(reread)) {
      return claimVerifiedInstall(params, reread);
    }
  }
  throw new SentryVerificationInProgressError(params.installationUuid);
}

type VerifiedUnclaimedSentryInstallation = SentryInstallation & {
  connectionId: null;
  status: 'installed';
  orgSlug: string;
  codeHash: string;
};

function isVerifiedUnclaimed(
  install: SentryInstallation,
): install is VerifiedUnclaimedSentryInstallation {
  return (
    install.connectionId === null && install.status === 'installed' && install.codeHash !== null
  );
}

function bindClaim(
  params: HandleSentryConnectParams,
  binding: {orgSlug: string; codeHash: string},
): Promise<IntegrationConnection<'sentry'>> {
  return params.connectSentryInstallation({
    workspaceId: params.workspaceId,
    installationUuid: params.installationUuid,
    orgSlug: binding.orgSlug,
    displayName: `Sentry ${binding.orgSlug}`,
    installerUserId: params.installerUserId,
    codeHash: binding.codeHash,
  });
}

export async function verifySentryInstallationBestEffort(input: {
  sentry: SentryApiClient;
  installationUuid: string;
  token: string;
  connectionId?: string;
}): Promise<void> {
  // The row is already persisted and receiving webhooks, so a verify failure only
  // leaves the install pending on Sentry's side (re-verifying needs a fresh token
  // we cannot mint here). Log it rather than failing a working claim.
  try {
    await input.sentry.verifyInstallation({
      installationUuid: input.installationUuid,
      token: input.token,
    });
  } catch (error) {
    logger().warn(
      {installationUuid: input.installationUuid, connectionId: input.connectionId, err: error},
      'sentry connect: verify-install failed after persistence',
    );
  }
}

// The Sentry client collapses a reused, expired, or forged code to a single
// `access-denied` provider error; we cannot tell them apart from the response.
// On an install we already know was verified, the most likely cause is the code
// having been spent already, so the hash check disambiguates rather than the
// error itself.
function isCodeAlreadyUsed(error: unknown): boolean {
  return error instanceof SentryIntegrationProviderError && error.reason === 'access-denied';
}
