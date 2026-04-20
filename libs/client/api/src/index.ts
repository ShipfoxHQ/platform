import ky, {type Options as KyOptions} from 'ky';

export interface ApiClientOptions {
  baseUrl?: string;
  getAccessToken?: (() => string | undefined) | undefined;
  refreshAccessToken?: (() => Promise<string | undefined> | string | undefined) | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal | undefined;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(params: {message: string; code: string; status: number; details?: unknown}) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
  }
}

let apiOptions: ApiClientOptions = {};
const TRAILING_SLASH_RE = /\/$/;
const LEADING_SLASH_RE = /^\//;
const AUTH_REFRESH_PATH_RE = /\/auth\/refresh\/?$/;

function defaultBaseUrl(): string {
  return apiOptions.baseUrl ?? import.meta.env.VITE_API_URL ?? '';
}

export function configureApiClient(options: ApiClientOptions): void {
  apiOptions = {...apiOptions, ...options};
}

export function getErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

export function isErrorWithCode(error: unknown, code: string): boolean {
  return getErrorCode(error) === code;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(TRAILING_SLASH_RE, '')}/${path.replace(LEADING_SLASH_RE, '')}`;
}

function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

function toApiError(response: Response, parsed: unknown): ApiError {
  const payload = typeof parsed === 'object' && parsed !== null ? parsed : {};
  const record = payload as {message?: unknown; code?: unknown};
  return new ApiError({
    message: typeof record.message === 'string' ? record.message : response.statusText,
    code: typeof record.code === 'string' ? record.code : 'request-failed',
    status: response.status,
    details: parsed,
  });
}

async function sendApiRequest<T>(url: string, requestInit: KyOptions): Promise<T> {
  let response: Response;
  try {
    response = await ky(url, requestInit);
  } catch (error) {
    throw new ApiError({
      message: error instanceof Error ? error.message : 'Network request failed',
      code: 'network-error',
      status: 0,
      details: {url, error},
    });
  }

  const parsed = await parseResponseBody(response);
  if (!response.ok) {
    throw toApiError(response, parsed);
  }

  return parsed as T;
}

function shouldRefreshAccessToken(params: {
  error: ApiError;
  path: string;
  usedConfiguredAccessToken: boolean;
}): boolean {
  return (
    params.error.status === 401 &&
    params.error.code === 'unauthorized' &&
    params.usedConfiguredAccessToken &&
    !AUTH_REFRESH_PATH_RE.test(params.path)
  );
}

function createRequestInit(options: ApiRequestOptions, headers: Headers): KyOptions {
  const requestInit: KyOptions = {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers,
    fetch: apiOptions.fetchImpl ?? defaultFetch,
    retry: 0,
    throwHttpErrors: false,
    timeout: false,
  };

  if (options.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (options.body !== undefined) {
    requestInit.body = JSON.stringify(options.body);
  }
  if (options.signal) {
    requestInit.signal = options.signal;
  }

  return requestInit;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const hasCallerAuthorization = headers.has('authorization');
  const accessToken = apiOptions.getAccessToken?.();
  const baseUrl = defaultBaseUrl();
  const url = joinUrl(baseUrl, path);
  const requestInit = createRequestInit(options, headers);

  if (accessToken && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  const usedConfiguredAccessToken = Boolean(accessToken && !hasCallerAuthorization);
  try {
    return await sendApiRequest<T>(url, requestInit);
  } catch (error) {
    if (
      error instanceof ApiError &&
      apiOptions.refreshAccessToken &&
      shouldRefreshAccessToken({error, path, usedConfiguredAccessToken})
    ) {
      const refreshedToken = await apiOptions.refreshAccessToken();
      if (refreshedToken) {
        headers.set('authorization', `Bearer ${refreshedToken}`);
        return await sendApiRequest<T>(url, requestInit);
      }
    }
    throw error;
  }
}
