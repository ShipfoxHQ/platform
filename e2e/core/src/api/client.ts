import ky, {HTTPError, type Options as KyOptions, type ResponsePromise as KyResponse} from 'ky';
import {config} from '../config.js';

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

const api = ky.create({
  headers: {
    authorization: `Bearer ${config.E2E_ADMIN_API_KEY}`,
  },
  retry: 0,
  timeout: false,
});

function e2eUrl(path: string): URL {
  return new URL(path, config.API_URL);
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

async function toE2eApiError(error: unknown): Promise<E2eApiError> {
  if (error instanceof HTTPError) {
    return new E2eApiError({
      message: `E2E API request failed: ${error.response.status}`,
      status: error.response.status,
      details: await parseErrorDetails(error.response),
    });
  }

  return new E2eApiError({
    message: error instanceof Error ? error.message : 'E2E API request failed',
    status: 0,
    details: error,
  });
}

export async function request<T>(
  method: 'get' | 'post' | 'put' | 'delete' | 'patch',
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
  method: 'get' | 'post' | 'put' | 'delete' | 'patch',
  path: string,
  params: KyOptions,
): Promise<T> {
  try {
    return await api[method](e2eUrl(path), params).json<T>();
  } catch (error) {
    throw await toE2eApiError(error);
  }
}
