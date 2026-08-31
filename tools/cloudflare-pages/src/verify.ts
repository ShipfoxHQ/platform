import type {CloudflarePagesDeployment} from './deploy.js';
import type {CloudflarePagesApp, CloudflarePagesEndpoint} from './plan.js';

type CloudflarePagesEndpointResult = {
  id: string;
  path: string;
  ok: boolean;
  status: number | null;
  error?: string;
};

type CloudflarePagesAppVerification = {
  appId: string;
  ok: boolean;
  url: string | null;
  commitSha: string | null | undefined;
  pullRequest: string | null;
  endpoints: CloudflarePagesEndpointResult[];
  errors: string[];
};

type FetchOptions = {
  attempts: number;
  retryDelayMs: number;
  fetchImpl: typeof globalThis.fetch;
  headers?: Record<string, string> | undefined;
  redirect?: 'error' | 'follow' | 'manual' | undefined;
};

type VerificationCheck = {
  ok: boolean;
  status: number | null;
  error?: string;
};

type ConfiguredEndpoint = {
  id?: string | undefined;
  path: string;
  requireNonEmpty?: boolean | undefined;
};

const trailingSlashPattern = /\/$/;

function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(trailingSlashPattern, '')}/`).toString();
}

async function fetchWithRetry(url: string, options: FetchOptions): Promise<Response> {
  const {attempts, retryDelayMs, fetchImpl, ...requestOptions} = options;
  const fetchRequestOptions: RequestInit = {};
  if (requestOptions.headers !== undefined) fetchRequestOptions.headers = requestOptions.headers;
  if (requestOptions.redirect !== undefined) fetchRequestOptions.redirect = requestOptions.redirect;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...fetchRequestOptions,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) await wait(attempt * retryDelayMs);
    }
  }

  throw new Error(
    `Failed to fetch ${url}: ${lastError instanceof Error ? lastError.message : lastError}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkHttp(
  baseUrl: string,
  path: string,
  options: FetchOptions,
): Promise<VerificationCheck> {
  try {
    const response = await fetchWithRetry(getUrl(baseUrl, path), options);
    return {ok: true, status: response.status};
  } catch (error) {
    return {ok: false, status: null, error: errorMessage(error)};
  }
}

async function checkJson(
  baseUrl: string,
  path: string,
  options: FetchOptions,
): Promise<VerificationCheck & {value?: unknown}> {
  try {
    const response = await fetchWithRetry(getUrl(baseUrl, path), options);
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new Error(`Expected JSON at ${path}: ${errorMessage(error)}`);
    }
    return {ok: true, status: response.status, value};
  } catch (error) {
    return {ok: false, status: null, error: errorMessage(error)};
  }
}

function assertMetadata(
  metadata: unknown,
  expectedCommitSha: string,
  expectedPullRequest: string | undefined,
): void {
  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error('Cloudflare Pages deployment metadata is not an object');
  }
  const metadataObject = metadata as Record<string, unknown>;
  if (metadataObject.commitSha !== expectedCommitSha) {
    throw new Error(`Cloudflare Pages metadata commit does not match ${expectedCommitSha}`);
  }
  const pullRequest = metadataObject.pullRequest;
  if (
    expectedPullRequest !== undefined &&
    expectedPullRequest.length > 0 &&
    (typeof pullRequest !== 'object' ||
      pullRequest === null ||
      (pullRequest as Record<string, unknown>).number !== Number(expectedPullRequest))
  ) {
    throw new Error(`Cloudflare Pages metadata does not match pull request ${expectedPullRequest}`);
  }
}

function assertEndpointResponse(response: unknown, endpoint: ConfiguredEndpoint): void {
  if (!endpoint.requireNonEmpty) return;
  if (typeof response !== 'object' || response === null || Object.keys(response).length === 0) {
    throw new Error(`Cloudflare Pages endpoint ${endpoint.path} returned an empty JSON object`);
  }
  if (
    !Array.isArray(response) &&
    'entries' in response &&
    (typeof response.entries !== 'object' ||
      response.entries === null ||
      Object.keys(response.entries).length === 0)
  ) {
    throw new Error(`Cloudflare Pages endpoint ${endpoint.path} contains no entries`);
  }
}

/**
 * Verify a deployed Cloudflare Pages application.
 */
export async function verifyPagesDeployment({
  baseUrl = process.env.CLOUDFLARE_PAGES_URL,
  expectedCommitSha = process.env.CLOUDFLARE_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA,
  expectedPullRequest = process.env.CLOUDFLARE_PAGES_PR_NUMBER,
  metadataPath = '/preview-metadata.json',
  endpoints = [],
  attempts = 3,
  retryDelayMs = 2_000,
  fetchImpl = globalThis.fetch,
}: {
  baseUrl?: string | undefined;
  expectedCommitSha?: string | undefined;
  expectedPullRequest?: string | undefined;
  metadataPath?: string | undefined;
  endpoints?: CloudflarePagesEndpoint[] | undefined;
  attempts?: number | undefined;
  retryDelayMs?: number | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
}): Promise<{
  ok: boolean;
  url: string;
  commitSha: string;
  pullRequest: string | null;
  rootStatus: number | null;
  root: VerificationCheck;
  metadataPath: string;
  metadata: VerificationCheck;
  endpoints: CloudflarePagesEndpointResult[];
  errors: string[];
}> {
  const resolvedBaseUrl = required(baseUrl, 'baseUrl');
  const resolvedExpectedCommitSha = required(expectedCommitSha, 'expectedCommitSha');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');
  if (!Number.isInteger(attempts) || attempts < 1)
    throw new Error('attempts must be a positive integer');

  const fetchOptions = {
    attempts,
    retryDelayMs,
    fetchImpl,
    headers: {accept: 'application/json'},
  };
  const root = await checkHttp(resolvedBaseUrl, '/', {
    ...fetchOptions,
    redirect: 'follow',
  });
  const metadataResponse = await checkJson(resolvedBaseUrl, metadataPath, fetchOptions);
  const metadata = verifyMetadataResponse(
    metadataResponse,
    resolvedExpectedCommitSha,
    expectedPullRequest,
  );

  const verifiedEndpoints: CloudflarePagesEndpointResult[] = [];
  for (const configuredEndpoint of endpoints) {
    verifiedEndpoints.push(
      await verifyConfiguredEndpoint(resolvedBaseUrl, configuredEndpoint, fetchOptions),
    );
  }

  const errors: string[] = [];
  if (!root.ok) errors.push(`Root: ${root.error}`);
  if (!metadata.ok) errors.push(`Metadata: ${metadata.error}`);
  for (const endpoint of verifiedEndpoints) {
    if (!endpoint.ok) errors.push(`${endpoint.id}: ${endpoint.error}`);
  }

  return {
    ok: root.ok && metadata.ok && verifiedEndpoints.every((endpoint) => endpoint.ok),
    url: resolvedBaseUrl.replace(trailingSlashPattern, ''),
    commitSha: resolvedExpectedCommitSha,
    pullRequest: expectedPullRequest ?? null,
    rootStatus: root.status,
    root,
    metadataPath,
    metadata,
    endpoints: verifiedEndpoints,
    errors,
  };
}

function verifyMetadataResponse(
  response: Awaited<ReturnType<typeof checkJson>>,
  expectedCommitSha: string,
  expectedPullRequest: string | undefined,
): VerificationCheck {
  const metadata: VerificationCheck = {ok: response.ok, status: response.status};
  if (!response.ok) {
    if (response.error !== undefined) metadata.error = response.error;
    return metadata;
  }
  try {
    assertMetadata(response.value, expectedCommitSha, expectedPullRequest);
  } catch (error) {
    metadata.ok = false;
    metadata.error = errorMessage(error);
  }
  return metadata;
}

async function verifyConfiguredEndpoint(
  baseUrl: string,
  configuredEndpoint: CloudflarePagesEndpoint,
  fetchOptions: Parameters<typeof checkJson>[2],
): Promise<CloudflarePagesEndpointResult> {
  const endpoint =
    typeof configuredEndpoint === 'string'
      ? {id: configuredEndpoint, path: configuredEndpoint, requireNonEmpty: false}
      : configuredEndpoint;
  const response = await checkJson(baseUrl, endpoint.path, fetchOptions);
  const result: CloudflarePagesEndpointResult = {
    id: endpoint.id ?? endpoint.path,
    path: endpoint.path,
    ok: response.ok,
    status: response.status,
  };
  if (!response.ok) {
    if (response.error !== undefined) result.error = response.error;
    return result;
  }
  try {
    assertEndpointResponse(response.value, endpoint);
  } catch (error) {
    result.ok = false;
    result.error = errorMessage(error);
  }
  return result;
}

/**
 * Verify each selected application against its own deployed URL.
 */
export async function verifyCloudflarePagesApps({
  apps,
  deployments,
  selectedAppIds = apps.map((app) => app.id),
  expectedCommitSha = process.env.CLOUDFLARE_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA,
  expectedPullRequest = process.env.CLOUDFLARE_PAGES_PR_NUMBER,
  attempts = 3,
  retryDelayMs = 2_000,
  fetchImpl = globalThis.fetch,
}: {
  apps: CloudflarePagesApp[];
  deployments: CloudflarePagesDeployment[];
  selectedAppIds?: string[] | undefined;
  expectedCommitSha?: string | undefined;
  expectedPullRequest?: string | undefined;
  attempts?: number | undefined;
  retryDelayMs?: number | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
}) {
  const selectedApps = apps.filter((app) => selectedAppIds.includes(app.id));
  const deploymentByApp = new Map(deployments.map((deployment) => [deployment.appId, deployment]));
  const reports: CloudflarePagesAppVerification[] = [];

  for (const app of selectedApps) {
    reports.push(
      await verifyCloudflarePagesApp({
        app,
        deployment: deploymentByApp.get(app.id),
        expectedCommitSha,
        expectedPullRequest,
        attempts,
        retryDelayMs,
        fetchImpl,
      }),
    );
  }

  return {
    ok: selectedApps.length > 0 && reports.every((report) => report.ok),
    commitSha: expectedCommitSha,
    pullRequest: expectedPullRequest ?? null,
    apps: reports,
    errors: [
      ...(selectedApps.length === 0 ? ['No applications were selected for verification'] : []),
      ...reports.flatMap((report) =>
        report.ok ? [] : report.errors.map((error) => `${report.appId}: ${error}`),
      ),
    ],
  };
}

async function verifyCloudflarePagesApp(params: {
  app: CloudflarePagesApp;
  deployment: CloudflarePagesDeployment | undefined;
  expectedCommitSha: string | undefined;
  expectedPullRequest: string | undefined;
  attempts: number;
  retryDelayMs: number;
  fetchImpl: typeof globalThis.fetch;
}): Promise<CloudflarePagesAppVerification> {
  const {app, deployment} = params;
  if (deployment === undefined) {
    return failedAppVerification(app.id, null, params, 'application was not deployed');
  }
  if (!deployment.ok || deployment.url === undefined) {
    return failedAppVerification(
      app.id,
      null,
      {...params, expectedCommitSha: params.expectedCommitSha ?? deployment.commitSha},
      deployment.error ?? 'application deployment did not complete',
    );
  }
  try {
    const report = await verifyPagesDeployment({
      baseUrl: deployment.url,
      expectedCommitSha: params.expectedCommitSha,
      expectedPullRequest: params.expectedPullRequest,
      metadataPath: app.verify?.metadataPath ?? '/preview-metadata.json',
      endpoints: app.verify?.endpoints ?? [],
      attempts: params.attempts,
      retryDelayMs: params.retryDelayMs,
      fetchImpl: params.fetchImpl,
    });
    return {appId: app.id, ...report};
  } catch (error) {
    return failedAppVerification(app.id, deployment.url, params, errorMessage(error));
  }
}

function failedAppVerification(
  appId: string,
  url: string | null,
  params: {expectedCommitSha: string | undefined; expectedPullRequest: string | undefined},
  error: string,
): CloudflarePagesAppVerification {
  return {
    appId,
    ok: false,
    url,
    commitSha: params.expectedCommitSha ?? null,
    pullRequest: params.expectedPullRequest ?? null,
    endpoints: [],
    errors: [error],
  };
}
