import type {PreviewDeployment} from './deploy.js';
import type {PreviewApp} from './plan.js';

type PreviewEndpointResult = {
  id: string;
  path: string;
  ok: boolean;
  status: number | null;
  error?: string;
};

type PreviewAppVerification = {
  appId: string;
  ok: boolean;
  url: string | null;
  commitSha: string | null | undefined;
  pullRequest: string | null;
  endpoints: PreviewEndpointResult[];
  errors: string[];
};

function required(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getUrl(baseUrl, path) {
  return new URL(path, `${baseUrl.replace(trailingSlashPattern, '')}/`).toString();
}

async function fetchWithRetry(url, {attempts, retryDelayMs, fetchImpl, ...options}) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...options,
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function checkHttp(baseUrl, path, options) {
  try {
    const response = await fetchWithRetry(getUrl(baseUrl, path), options);
    return {ok: true, status: response.status};
  } catch (error) {
    return {ok: false, status: null, error: errorMessage(error)};
  }
}

async function checkJson(baseUrl, path, options) {
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

function assertMetadata(metadata, expectedCommitSha, expectedPullRequest) {
  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error('Preview metadata is not an object');
  }
  if (metadata.commitSha !== expectedCommitSha) {
    throw new Error(`Preview metadata commit does not match ${expectedCommitSha}`);
  }
  if (
    expectedPullRequest !== undefined &&
    expectedPullRequest.length > 0 &&
    metadata.pullRequest?.number !== Number(expectedPullRequest)
  ) {
    throw new Error(`Preview metadata does not match pull request ${expectedPullRequest}`);
  }
}

function assertEndpointResponse(response, endpoint) {
  if (!endpoint.requireNonEmpty) return;
  if (typeof response !== 'object' || response === null || Object.keys(response).length === 0) {
    throw new Error(`Preview endpoint ${endpoint.path} returned an empty JSON object`);
  }
  if ('entries' in response && Object.keys(response.entries ?? {}).length === 0) {
    throw new Error(`Preview endpoint ${endpoint.path} contains no entries`);
  }
}

/**
 * Verify a deployed static preview without assuming a specific hosting provider.
 */
export async function verifyPreview({
  baseUrl = process.env.PREVIEW_URL,
  expectedCommitSha = process.env.PREVIEW_COMMIT_SHA ?? process.env.GITHUB_SHA,
  expectedPullRequest = process.env.PREVIEW_PR_NUMBER,
  metadataPath = '/preview-metadata.json',
  endpoints = [],
  attempts = 3,
  retryDelayMs = 2_000,
  fetchImpl = globalThis.fetch,
}) {
  required(baseUrl, 'baseUrl');
  required(expectedCommitSha, 'expectedCommitSha');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');
  if (!Number.isInteger(attempts) || attempts < 1)
    throw new Error('attempts must be a positive integer');

  const fetchOptions = {
    attempts,
    retryDelayMs,
    fetchImpl,
    headers: {accept: 'application/json'},
  };
  const root = await checkHttp(baseUrl, '/', {
    ...fetchOptions,
    redirect: 'follow',
  });
  const metadataResponse = await checkJson(baseUrl, metadataPath, fetchOptions);
  const metadata = {
    ok: metadataResponse.ok,
    status: metadataResponse.status,
  };
  if (metadataResponse.ok) {
    try {
      assertMetadata(metadataResponse.value, expectedCommitSha, expectedPullRequest);
    } catch (error) {
      metadata.ok = false;
      metadata.error = errorMessage(error);
    }
  } else {
    metadata.error = metadataResponse.error;
  }

  const verifiedEndpoints: PreviewEndpointResult[] = [];
  for (const configuredEndpoint of endpoints) {
    const endpoint =
      typeof configuredEndpoint === 'string'
        ? {id: configuredEndpoint, path: configuredEndpoint, requireNonEmpty: false}
        : configuredEndpoint;
    const response = await checkJson(baseUrl, endpoint.path, fetchOptions);
    const result = {
      id: endpoint.id ?? endpoint.path,
      path: endpoint.path,
      ok: response.ok,
      status: response.status,
    };
    if (!response.ok) {
      result.error = response.error;
    } else {
      try {
        assertEndpointResponse(response.value, endpoint);
      } catch (error) {
        result.ok = false;
        result.error = errorMessage(error);
      }
    }
    verifiedEndpoints.push(result);
  }

  const errors: string[] = [];
  if (!root.ok) errors.push(`Root: ${root.error}`);
  if (!metadata.ok) errors.push(`Metadata: ${metadata.error}`);
  for (const endpoint of verifiedEndpoints) {
    if (!endpoint.ok) errors.push(`${endpoint.id}: ${endpoint.error}`);
  }

  return {
    ok: root.ok && metadata.ok && verifiedEndpoints.every((endpoint) => endpoint.ok),
    url: baseUrl.replace(trailingSlashPattern, ''),
    commitSha: expectedCommitSha,
    pullRequest: expectedPullRequest ?? null,
    rootStatus: root.status,
    root,
    metadataPath,
    metadata,
    endpoints: verifiedEndpoints,
    errors,
  };
}

/**
 * Verify each selected application against its own deployed URL.
 */
export async function verifyPreviewApps({
  apps,
  deployments,
  selectedAppIds = apps.map((app) => app.id),
  expectedCommitSha = process.env.PREVIEW_COMMIT_SHA ?? process.env.GITHUB_SHA,
  expectedPullRequest = process.env.PREVIEW_PR_NUMBER,
  attempts = 3,
  retryDelayMs = 2_000,
  fetchImpl = globalThis.fetch,
}: {
  apps: PreviewApp[];
  deployments: PreviewDeployment[];
  selectedAppIds?: string[];
  expectedCommitSha?: string;
  expectedPullRequest?: string;
  attempts?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}) {
  const selectedApps = apps.filter((app) => selectedAppIds.includes(app.id));
  const deploymentByApp = new Map(deployments.map((deployment) => [deployment.appId, deployment]));
  const reports: PreviewAppVerification[] = [];

  for (const app of selectedApps) {
    const deployment = deploymentByApp.get(app.id);
    if (deployment === undefined) {
      reports.push({
        appId: app.id,
        ok: false,
        url: null,
        commitSha: expectedCommitSha ?? null,
        pullRequest: expectedPullRequest ?? null,
        endpoints: [],
        errors: ['application was not deployed'],
      });
      continue;
    }
    if (!deployment.ok || deployment.url === undefined) {
      reports.push({
        appId: app.id,
        ok: false,
        url: null,
        commitSha: expectedCommitSha ?? deployment.commitSha,
        pullRequest: expectedPullRequest ?? null,
        endpoints: [],
        errors: [deployment.error ?? 'application deployment did not complete'],
      });
      continue;
    }

    try {
      const report = await verifyPreview({
        baseUrl: deployment.url,
        expectedCommitSha,
        expectedPullRequest,
        metadataPath: app.verify?.metadataPath ?? '/preview-metadata.json',
        endpoints: app.verify?.endpoints ?? [],
        attempts,
        retryDelayMs,
        fetchImpl,
      });
      reports.push({appId: app.id, ...report});
    } catch (error) {
      reports.push({
        appId: app.id,
        ok: false,
        url: deployment.url,
        commitSha: expectedCommitSha ?? deployment.commitSha,
        pullRequest: expectedPullRequest ?? null,
        endpoints: [],
        errors: [errorMessage(error)],
      });
    }
  }

  return {
    ok: reports.every((report) => report.ok),
    commitSha: expectedCommitSha,
    pullRequest: expectedPullRequest ?? null,
    apps: reports,
    errors: reports.flatMap((report) =>
      report.ok ? [] : report.errors.map((error) => `${report.appId}: ${error}`),
    ),
  };
}
const trailingSlashPattern = /\/$/;
