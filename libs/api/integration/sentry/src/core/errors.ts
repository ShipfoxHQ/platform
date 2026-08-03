import {IntegrationProviderError} from '@shipfox/api-integration-spi';

export class SentryIntegrationProviderError extends IntegrationProviderError {}

export class SentryInstallationAlreadyLinkedError extends Error {
  constructor(public readonly installationUuid: string) {
    super(
      `Sentry installation is already linked to another Shipfox workspace: ${installationUuid}`,
    );
    this.name = 'SentryInstallationAlreadyLinkedError';
  }
}

/**
 * The claim could not prove control of the named install: the presented code
 * neither exchanged successfully nor matched the stored `code_hash`. Surfaced as
 * a 403 so a forged or leaked bare uuid cannot bind someone else's install.
 */
export class SentryClaimProofMismatchError extends Error {
  constructor(public readonly installationUuid: string) {
    super(`Sentry claim could not be verified for installation: ${installationUuid}`);
    this.name = 'SentryClaimProofMismatchError';
  }
}

/**
 * A concurrent path (the signed webhook) is mid-exchange for this install, so the
 * verified row is not visible to the claim yet. Retryable: the existing client
 * backoff re-calls and finds the now-persisted row.
 */
export class SentryVerificationInProgressError extends Error {
  constructor(
    public readonly installationUuid: string,
    public readonly retryAfterSeconds = 2,
  ) {
    super(`Sentry installation verification is still in progress: ${installationUuid}`);
    this.name = 'SentryVerificationInProgressError';
  }
}

/**
 * Base for issue deliveries we received and authenticated but deliberately do
 * not publish. The webhook layer records them for dedup and acknowledges with a
 * 204 rather than treating them as failures: a sustained non-2xx can make Sentry
 * disable the webhook. Carries no HTTP concerns so workers/jobs can reuse it.
 */
export class SentryIssueDroppedError extends Error {}

export class SentryInstallationNotFoundError extends SentryIssueDroppedError {
  constructor(public readonly installationUuid: string) {
    super(`Sentry installation not found: ${installationUuid}`);
    this.name = 'SentryInstallationNotFoundError';
  }
}

export class SentryInstallationDeletedError extends SentryIssueDroppedError {
  constructor(public readonly installationUuid: string) {
    super(`Sentry installation is deleted: ${installationUuid}`);
    this.name = 'SentryInstallationDeletedError';
  }
}

export class SentryConnectionNotFoundError extends SentryIssueDroppedError {
  constructor(public readonly connectionId: string) {
    super(`Sentry installation has no connection: ${connectionId}`);
    this.name = 'SentryConnectionNotFoundError';
  }
}

/**
 * A verified install that no workspace has claimed yet (`connection_id IS NULL`),
 * so an issue delivery has no workspace to publish against. Dropped (204) like the
 * other pre-publish cases; kept distinct from SentryConnectionNotFoundError so the
 * carried identifier is unambiguously an installation uuid, not a connection id.
 */
export class SentryInstallationUnclaimedError extends SentryIssueDroppedError {
  constructor(public readonly installationUuid: string) {
    super(`Sentry installation is verified but not yet claimed: ${installationUuid}`);
    this.name = 'SentryInstallationUnclaimedError';
  }
}
