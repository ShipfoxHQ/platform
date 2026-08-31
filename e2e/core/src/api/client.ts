import ky, {HTTPError, type Options as KyOptions, type ResponsePromise as KyResponse} from 'ky';
import {config} from '../config.js';

export type ApiMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';
export type ApiFetch = (input: URL, init?: RequestInit) => Promise<Response> | Response;

export class E2eApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(params: {message: string; status: number; details: unknown}) {
    super(params.message);
    this.name = 'E2eApiError';
    this.status = params.status;
    this.details = params.details;
  }
}

export interface ApiClientRequestOptions {
  body?: RequestInit['body'] | undefined;
  headers?: RequestInit['headers'] | undefined;
  json?: unknown;
  signal?: AbortSignal | undefined;
}

export interface ApiClientOptions {
  apiUrl?: string | undefined;
  fetch?: ApiFetch | undefined;
  token: string;
}

const api = ky.create({
  headers: {
    authorization: `Bearer ${config.E2E_ADMIN_API_KEY}`,
  },
  retry: 0,
  timeout: false,
});

function e2eUrl(path: string, apiUrl = config.API_URL): URL {
  return new URL(path, apiUrl);
}

async function parseErrorDetails(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function parseHttpErrorDetails(error: HTTPError): Promise<unknown> {
  if (error.data !== undefined) return error.data;
  if (error.response.bodyUsed) return undefined;
  return await parseErrorDetails(error.response);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function toE2eApiError(error: unknown): Promise<E2eApiError> {
  if (error instanceof HTTPError) {
    return new E2eApiError({
      message: `E2E API request failed: ${error.response.status}`,
      status: error.response.status,
      details: await parseHttpErrorDetails(error),
    });
  }

  return new E2eApiError({
    message: error instanceof Error ? error.message : 'E2E API request failed',
    status: 0,
    details: error,
  });
}

function appendHeaders(headers: Headers, source: RequestInit['headers'] | undefined): void {
  if (!source) return;
  new Headers(source).forEach((value, key) => {
    headers.set(key, value);
  });
}

function buildRequestInit(
  method: ApiMethod,
  params: ApiClientRequestOptions,
  token: string,
): RequestInit {
  const headers = new Headers();
  headers.set('authorization', `Bearer ${token}`);
  appendHeaders(headers, params.headers);

  let body = params.body;
  if (params.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(params.json);
  }

  const requestInit: RequestInit = {headers, method: method.toUpperCase()};
  if (body !== undefined) requestInit.body = body;
  if (params.signal) requestInit.signal = params.signal;
  return requestInit;
}

function requestFailure(error: unknown, requestLabel: string): E2eApiError {
  const suffix = error instanceof Error ? `: ${error.message}` : '';
  return new E2eApiError({
    message: `E2E API request failed for ${requestLabel}${suffix}`,
    status: 0,
    details: error,
  });
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const apiUrl = options.apiUrl ?? config.API_URL;

  async function clientRequest(
    method: ApiMethod,
    path: string,
    params: ApiClientRequestOptions = {},
  ): Promise<Response> {
    const requestLabel = `${method.toUpperCase()} ${path}`;
    const requestInit = buildRequestInit(method, params, options.token);

    let response: Response;
    try {
      response = await fetchImpl(e2eUrl(path, apiUrl), requestInit);
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw requestFailure(error, requestLabel);
    }

    if (!response.ok) {
      throw new E2eApiError({
        message: `E2E API request failed for ${requestLabel}: ${response.status}`,
        status: response.status,
        details: await parseErrorDetails(response),
      });
    }

    return response;
  }

  return {
    request: clientRequest,
    requestJson: async <T>(
      method: ApiMethod,
      path: string,
      params: ApiClientRequestOptions = {},
    ): Promise<T> => {
      const response = await clientRequest(method, path, params);
      return (await response.json()) as T;
    },
  };
}

export async function request<T>(
  method: ApiMethod,
  path: string,
  params: KyOptions,
): Promise<Awaited<KyResponse<T>>> {
  try {
    return await api[method](e2eUrl(path), params);
  } catch (error) {
    throw await toE2eApiError(error);
  }
}

export async function requestJson<T>(
  method: ApiMethod,
  path: string,
  params: KyOptions,
): Promise<T> {
  try {
    return await api[method](e2eUrl(path), params).json<T>();
  } catch (error) {
    throw await toE2eApiError(error);
  }
}
