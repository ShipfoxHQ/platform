import {recordCredentialRenewal} from '#credential-metrics.js';

export type BrokerCredential = {
  username: string;
  token: string;
  generation?: string;

  expiresAt: number;
  renewal?: {mode: 'refresh-at'; refreshAt: number} | {mode: 'on-rejection'};
};

export type BrokerCredentialInput = Omit<BrokerCredential, 'expiresAt' | 'renewal'> & {
  expiresAt: number | Date | string;
  renewal?: {mode: 'refresh-at'; refreshAt: number | Date | string} | {mode: 'on-rejection'};
};

export type PersistedCheckoutCredential = {
  repositoryUrl: string;
  checkoutStepId: string;
  checkoutAttempt: number;
  credential: BrokerCredentialInput;
};

export type CredentialLookup = Pick<BrokerCredential, 'username' | 'token'>;

export type CredentialRenewalRequest = {
  repositoryUrl: string;
  subject: string;
  rejectedGeneration?: string;
};

export type CredentialRenewal = (
  request: CredentialRenewalRequest,
) => BrokerCredentialInput | Promise<BrokerCredentialInput>;

export type CredentialFailureKind = 'auth' | 'unavailable' | 'failed';

export type CredentialFailureEvent = {
  readonly cursor: number;
  readonly repositoryUrl: string;
  readonly subject: string;
  readonly kind: CredentialFailureKind;
};

export type CredentialFailureClassifier = (error: unknown) => CredentialFailureKind;

export type CredentialFailureCapture<T> = {
  readonly value: T;
  readonly events: readonly CredentialFailureEvent[];
};

export type CredentialFailureEventSource = {
  getFailureEventCursor(): number;
  getFailureEventsSince(cursor: number): readonly CredentialFailureEvent[];
  captureFailureEvents<T>(operation: () => Promise<T>): Promise<CredentialFailureCapture<T>>;
};

export type CredentialBrokerOptions = {
  now?: () => number;
  renew: CredentialRenewal;
  classifyFailure?: CredentialFailureClassifier;
  publishSecrets?: (secrets: readonly string[]) => void | Promise<void>;
  replaceSecrets?: (secrets: readonly string[]) => void | Promise<void>;
  clearSecrets?: () => void | Promise<void>;
  backoffMs?: number;
  rejectionCooldownMs?: number;
  renewalTimeoutMs?: number;
};

export type RegisterCredentialOptions = {
  repositoryUrl: string;
  subject: string;
  credential: BrokerCredentialInput;
};

export type RejectionResult = {rejectedGeneration?: string};

const TRAILING_SLASHES = /\/+$/;
const MAX_REPOSITORY_URL_LENGTH = 2_048;
export const MAX_CREDENTIAL_FAILURE_EVENTS = 128;
export const DEFAULT_CREDENTIAL_RENEWAL_TIMEOUT_MS = 30_000;
export const DEFAULT_CREDENTIAL_REJECTION_COOLDOWN_MS = 1_000;

export function createCredentialBroker(options: CredentialBrokerOptions): CredentialBroker {
  return new CredentialBroker(options);
}

export class CredentialBrokerShutdownError extends Error {
  constructor() {
    super('Credential broker is shut down');
    this.name = 'CredentialBrokerShutdownError';
  }
}

export class TransientCredentialRenewalError extends Error {
  constructor(message = 'Credential renewal is temporarily unavailable', options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransientCredentialRenewalError';
  }
}

/**
 * A job-local, transport-independent credential cache. The broker never persists
 * credentials and all lookups fail closed after shutdown.
 */
export class CredentialBroker {
  private readonly entries = new Map<string, Entry>();
  private readonly flights = new Map<string, Flight>();
  private readonly failureEvents: CredentialFailureEvent[] = [];
  private readonly now: () => number;
  private readonly backoffMs: number;
  private readonly rejectionCooldownMs: number;
  private readonly renewalTimeoutMsValue: number;
  private publication: Promise<void> = Promise.resolve();
  private failureEventCursorValue = 0;
  private activeFailureCapture: FailureEventCapture | undefined;
  private stopped = false;

  constructor(private readonly options: CredentialBrokerOptions) {
    this.now = options.now ?? Date.now;
    this.backoffMs = options.backoffMs ?? 1000;
    this.rejectionCooldownMs =
      options.rejectionCooldownMs ?? DEFAULT_CREDENTIAL_REJECTION_COOLDOWN_MS;
    this.renewalTimeoutMsValue = options.renewalTimeoutMs ?? DEFAULT_CREDENTIAL_RENEWAL_TIMEOUT_MS;
    if (!Number.isFinite(this.backoffMs) || this.backoffMs < 0) {
      throw new RangeError('backoffMs must be a non-negative finite number');
    }
    if (!Number.isFinite(this.rejectionCooldownMs) || this.rejectionCooldownMs < 0) {
      throw new RangeError('rejectionCooldownMs must be a non-negative finite number');
    }
    if (!Number.isFinite(this.renewalTimeoutMsValue) || this.renewalTimeoutMsValue < 0) {
      throw new RangeError('renewalTimeoutMs must be a non-negative finite number');
    }
  }

  register(options: RegisterCredentialOptions): void {
    this.assertRunning();
    const url = normalizeRepositoryUrl(options.repositoryUrl);
    if (!options.subject) throw new TypeError('Credential checkout subject is required');
    const credential = normalizeCredential(options.credential);
    const flightKey = `${options.subject}\u0000${url}`;
    this.flights.delete(flightKey);
    this.entries.set(url, {
      url,
      subject: options.subject,
      credential,
      rejectedGeneration: undefined,
      backoffUntil: undefined,
      rejectionCooldownUntil: undefined,
    });
    void this.publish(credential).catch(() => undefined);
  }

  lookup(repositoryUrl: string): Promise<CredentialLookup | undefined> {
    if (this.stopped) return Promise.resolve(undefined);
    const url = tryNormalizeRepositoryUrl(repositoryUrl);
    if (url === undefined) return Promise.resolve(undefined);
    const entry = this.entries.get(url);
    if (!entry) return Promise.resolve(undefined);
    if (entry.rejected) return this.lookupRejectedEntry(entry, url);
    if (shouldRefresh(entry.credential, this.now())) return this.lookupRefreshEntry(entry, url);
    if (!isLookupUsable(entry.credential, this.now())) return Promise.resolve(undefined);

    return Promise.resolve(toLookup(entry.credential));
  }

  async reject(repositoryUrl: string): Promise<RejectionResult> {
    if (this.stopped) return {};
    const url = tryNormalizeRepositoryUrl(repositoryUrl);
    if (url === undefined) return {};
    const entry = this.entries.get(url);
    if (!entry) return {};
    entry.rejected = true;
    entry.rejectedGeneration = entry.credential.generation;
    const rejectedGeneration = entry.rejectedGeneration;
    await this.replacePublishedSecrets(entry);
    if (entry.credential.renewal?.mode !== 'on-rejection') {
      return rejectedGeneration === undefined ? {} : {rejectedGeneration};
    }
    const flightKey = `${entry.subject}\u0000${entry.url}`;
    const flight = this.flights.get(flightKey);
    const wasRefreshing = flight?.entry === entry && !flight.rejectionRequested;
    const needsFollowUp =
      flight?.entry === entry &&
      flight.rejectionRequested &&
      flight.rejectedGeneration !== rejectedGeneration;
    await this.renewEntry(entry, rejectedGeneration, true);
    if ((wasRefreshing || needsFollowUp) && !this.stopped)
      await this.renewEntry(entry, rejectedGeneration, true);
    return rejectedGeneration === undefined ? {} : {rejectedGeneration};
  }

  erase(repositoryUrl: string): Promise<RejectionResult> {
    return this.reject(repositoryUrl);
  }

  store(_repositoryUrl: string, _credential?: CredentialLookup): void {
    // Git's store operation must not replace the server-authored credential.
  }

  get renewalTimeoutMs(): number {
    return this.renewalTimeoutMsValue;
  }

  getFailureEventCursor(): number {
    return this.failureEventCursorValue;
  }

  getFailureEventsSince(cursor: number): readonly CredentialFailureEvent[] {
    if (!Number.isSafeInteger(cursor)) return [];
    return this.failureEvents.filter((event) => event.cursor > cursor);
  }

  async captureFailureEvents<T>(operation: () => Promise<T>): Promise<CredentialFailureCapture<T>> {
    const previous = this.activeFailureCapture;
    const capture: FailureEventCapture = {active: true, events: []};
    this.activeFailureCapture = capture;
    try {
      const value = await operation();
      return {value, events: [...capture.events]};
    } finally {
      capture.active = false;
      this.activeFailureCapture = previous;
    }
  }

  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.entries.clear();
    this.flights.clear();
    void this.publication.then(() => this.options.clearSecrets?.()).catch(() => undefined);
  }

  private replacePublishedSecrets(excluded?: Entry): Promise<void> {
    if (this.options.replaceSecrets) {
      const replacement = this.publication.then(async () => {
        if (this.stopped) return;
        const secrets = new Set<string>();
        for (const entry of this.entries.values()) {
          if (entry === excluded || entry.rejected || !isUsable(entry.credential, this.now())) {
            continue;
          }
          for (const secret of credentialSecrets(entry.credential)) secrets.add(secret);
        }
        await this.options.replaceSecrets?.([...secrets]);
      });
      this.publication = replacement.catch(() => undefined);
      return replacement;
    }

    return this.clearAndRepublishValidEntries(excluded);
  }

  private async clearAndRepublishValidEntries(excluded: Entry | undefined): Promise<void> {
    if (!this.options.clearSecrets) return;
    const clear = this.publication.then(() => this.options.clearSecrets?.());
    this.publication = clear.catch(() => undefined);
    await clear;
    if (excluded === undefined) return;
    for (const entry of this.entries.values()) {
      if (entry === excluded || entry.rejected || !isUsable(entry.credential, this.now())) continue;
      await this.publish(entry.credential).catch(() => undefined);
    }
  }

  private async lookupRejectedEntry(
    entry: Entry,
    url: string,
  ): Promise<CredentialLookup | undefined> {
    if (entry.credential.renewal?.mode !== 'refresh-at') return undefined;
    await this.renewEntry(entry, entry.rejectedGeneration, true);
    return this.lookupRenewedEntry(url);
  }

  private async lookupRefreshEntry(
    entry: Entry,
    url: string,
  ): Promise<CredentialLookup | undefined> {
    await this.renewEntry(entry);
    return this.lookupRenewedEntry(url);
  }

  private lookupRenewedEntry(url: string): CredentialLookup | undefined {
    if (this.stopped) return undefined;
    const entry = this.entries.get(url);
    if (!entry || entry.rejected || !isUsable(entry.credential, this.now())) return undefined;
    return toLookup(entry.credential);
  }

  private renewEntry(
    entry: Entry,
    rejectedGeneration?: string,
    rejectionRequested = false,
  ): Promise<void> {
    const flightKey = `${entry.subject}\u0000${entry.url}`;
    const existing = this.flights.get(flightKey);
    if (existing?.entry === entry) {
      if (this.activeFailureCapture !== undefined) {
        existing.failureCaptures.add(this.activeFailureCapture);
      }
      if (rejectionRequested) {
        existing.rejectionRequested = true;
        existing.rejectedGeneration = rejectedGeneration;
      }
      return existing.promise;
    }
    if (entry.backoffUntil !== undefined && this.now() < entry.backoffUntil)
      return Promise.resolve();
    if (
      rejectionRequested &&
      entry.rejectionCooldownUntil !== undefined &&
      this.now() < entry.rejectionCooldownUntil
    )
      return Promise.resolve();

    const failureCaptures = new Set<FailureEventCapture>();
    if (this.activeFailureCapture !== undefined) failureCaptures.add(this.activeFailureCapture);
    const flight: Flight = {
      entry,
      promise: Promise.resolve(),
      rejectionRequested,
      rejectedGeneration,
      failureCaptures,
    };
    const promise = this.performRenewal(flight).finally(() => {
      if (this.flights.get(flightKey)?.promise === promise) this.flights.delete(flightKey);
    });
    flight.promise = promise;
    this.flights.set(flightKey, flight);
    return promise;
  }

  private async performRenewal(flight: Flight): Promise<void> {
    const {entry} = flight;
    try {
      const input = await this.requestRenewal(entry, flight.rejectedGeneration);
      if (this.stopped) return;
      const credential = normalizeCredential(input);
      if (
        !this.applyRenewedCredential(
          entry,
          credential,
          flight.rejectedGeneration,
          flight.rejectionRequested,
        )
      ) {
        if (this.isCurrentRenewal(entry, flight.rejectionRequested)) {
          recordCredentialRenewal('failure');
          this.recordFailure(entry, 'failed', flight.failureCaptures);
        }
        return;
      }
      if (this.options.replaceSecrets) {
        await this.replacePublishedSecrets().catch(() => undefined);
      } else {
        await this.publish(credential).catch(() => undefined);
      }
      if (!this.isCurrentRenewal(entry, flight.rejectionRequested)) return;
      recordCredentialRenewal('success');
    } catch (error) {
      recordCredentialRenewal('failure');
      if (this.stopped) return;
      const current = this.isCurrentRenewal(entry, flight.rejectionRequested);
      this.handleRenewalError(entry, error);
      if (current && flight.rejectionRequested) {
        this.recordFailureFromError(entry, error, flight.failureCaptures);
      }
    }
  }

  private async requestRenewal(
    entry: Entry,
    rejectedGeneration: string | undefined,
  ): Promise<BrokerCredentialInput> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const renewal = Promise.resolve().then(() =>
        this.options.renew({
          repositoryUrl: entry.url,
          subject: entry.subject,
          ...(rejectedGeneration === undefined ? {} : {rejectedGeneration}),
        }),
      );
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TransientCredentialRenewalError('Credential renewal timed out')),
          this.renewalTimeoutMsValue,
        );
      });
      return await Promise.race([renewal, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private applyRenewedCredential(
    entry: Entry,
    credential: BrokerCredential,
    rejectedGeneration: string | undefined,
    rejectionRequested: boolean,
  ): boolean {
    if (!hasFreshGeneration(credential, rejectedGeneration, rejectionRequested)) {
      entry.rejected = true;
      entry.backoffUntil = undefined;
      return false;
    }
    if (!this.isCurrentRenewal(entry, rejectionRequested)) return false;
    entry.credential = credential;
    entry.rejected = false;
    entry.rejectedGeneration = undefined;
    entry.backoffUntil = undefined;
    entry.rejectionCooldownUntil = rejectionRequested
      ? this.now() + this.rejectionCooldownMs
      : undefined;
    return true;
  }

  private isCurrentRenewal(entry: Entry, rejectionRequested: boolean): boolean {
    return this.entries.get(entry.url) === entry && (rejectionRequested || !entry.rejected);
  }

  private handleRenewalError(entry: Entry, error: unknown): void {
    if (error instanceof TransientCredentialRenewalError) {
      entry.backoffUntil = this.now() + this.backoffMs;
      if (!isUsable(entry.credential, this.now())) entry.rejected = true;
      return;
    }
    entry.rejected = true;
    entry.backoffUntil = this.now() + this.backoffMs;
  }

  private recordFailure(
    entry: Entry,
    kind: CredentialFailureKind,
    failureCaptures: ReadonlySet<FailureEventCapture>,
  ): void {
    const event: CredentialFailureEvent = {
      cursor: ++this.failureEventCursorValue,
      repositoryUrl: entry.url,
      subject: entry.subject,
      kind,
    };
    this.failureEvents.push(event);
    if (this.failureEvents.length > MAX_CREDENTIAL_FAILURE_EVENTS) this.failureEvents.shift();
    for (const failureCapture of failureCaptures) {
      if (failureCapture.active && failureCapture.events.length < MAX_CREDENTIAL_FAILURE_EVENTS) {
        failureCapture.events.push(event);
      }
    }
  }

  private recordFailureFromError(
    entry: Entry,
    error: unknown,
    failureCaptures: ReadonlySet<FailureEventCapture>,
  ): void {
    let kind: CredentialFailureKind = 'failed';
    try {
      const classified = this.options.classifyFailure?.(error);
      if (isCredentialFailureKind(classified)) kind = classified;
    } catch {
      // A failure classifier is advisory; an invalid classifier result must not break renewal.
    }
    this.recordFailure(entry, kind, failureCaptures);
  }

  private publish(credential: BrokerCredential): Promise<void> {
    if (!this.options.publishSecrets) return Promise.resolve();
    const publication = this.publication.then(async () => {
      if (this.stopped) return;
      await this.options.publishSecrets?.(credentialSecrets(credential));
    });
    this.publication = publication.catch(() => undefined);
    return publication;
  }

  private assertRunning(): void {
    if (this.stopped) throw new CredentialBrokerShutdownError();
  }
}

type Entry = {
  url: string;
  subject: string;
  credential: BrokerCredential;
  rejected?: boolean;
  rejectedGeneration: string | undefined;
  backoffUntil: number | undefined;
  rejectionCooldownUntil: number | undefined;
};

type Flight = {
  entry: Entry;
  promise: Promise<void>;
  rejectionRequested: boolean;
  rejectedGeneration: string | undefined;
  failureCaptures: Set<FailureEventCapture>;
};

type FailureEventCapture = {
  active: boolean;
  events: CredentialFailureEvent[];
};

export function normalizeRepositoryUrl(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_REPOSITORY_URL_LENGTH ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new TypeError('Invalid repository URL');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Invalid repository URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError(
      'Repository URL must be an HTTPS URL without credentials or query parameters',
    );
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.port === '443') url.port = '';
  let path = url.pathname.replace(TRAILING_SLASHES, '');
  if (path.toLowerCase().endsWith('.git')) path = path.slice(0, -4).replace(TRAILING_SLASHES, '');
  if (!path || path === '/') throw new TypeError('Repository URL must include a path');
  url.pathname = `${path}/`;
  return url.toString();
}

function normalizeCredential(input: BrokerCredentialInput): BrokerCredential {
  const expiresAt = timestamp(input.expiresAt);
  if (
    typeof input.username !== 'string' ||
    typeof input.token !== 'string' ||
    input.username.length === 0 ||
    input.token.length === 0 ||
    !Number.isFinite(expiresAt)
  )
    throw new TypeError('Invalid checkout credential');
  if (
    input.generation !== undefined &&
    (typeof input.generation !== 'string' || input.generation.length === 0)
  )
    throw new TypeError('Invalid credential generation');

  const credential: BrokerCredential = {
    username: input.username,
    token: input.token,
    expiresAt,
    ...(input.generation === undefined ? {} : {generation: input.generation}),
  };
  if (input.renewal === undefined) return credential;
  if (input.renewal.mode === 'refresh-at') {
    const refreshAt = timestamp(input.renewal.refreshAt);
    if (!Number.isFinite(refreshAt) || refreshAt >= expiresAt)
      throw new TypeError('Invalid credential refresh deadline');
    return {...credential, renewal: {mode: 'refresh-at', refreshAt}};
  }
  if (input.renewal.mode !== 'on-rejection')
    throw new TypeError('Invalid credential renewal policy');
  return {...credential, renewal: {mode: 'on-rejection'}};
}

function timestamp(value: number | Date | string): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  return value;
}

function shouldRefresh(credential: BrokerCredential, now: number): boolean {
  return credential.renewal?.mode === 'refresh-at' && now >= credential.renewal.refreshAt;
}

function tryNormalizeRepositoryUrl(value: string): string | undefined {
  try {
    return normalizeRepositoryUrl(value);
  } catch {
    return undefined;
  }
}

function isUsable(credential: BrokerCredential, now: number): boolean {
  return credential.expiresAt > now;
}

function isLookupUsable(credential: BrokerCredential, now: number): boolean {
  return credential.renewal?.mode === 'on-rejection' || isUsable(credential, now);
}

function hasFreshGeneration(
  credential: BrokerCredential,
  rejectedGeneration: string | undefined,
  rejectionRequested: boolean,
): boolean {
  if (!rejectionRequested) return true;
  return credential.generation !== undefined && credential.generation !== rejectedGeneration;
}

function toLookup(credential: BrokerCredential): CredentialLookup {
  return {username: credential.username, token: credential.token};
}

function credentialSecrets(credential: BrokerCredential): string[] {
  return [
    credential.token,
    Buffer.from(`${credential.username}:${credential.token}`).toString('base64'),
  ];
}

function isCredentialFailureKind(value: unknown): value is CredentialFailureKind {
  return value === 'auth' || value === 'unavailable' || value === 'failed';
}
