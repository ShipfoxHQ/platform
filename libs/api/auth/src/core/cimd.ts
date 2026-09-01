import {promises as dnsPromises} from 'node:dns';
import type {IncomingMessage} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {oauthClientMetadataDocumentSchema} from '@shipfox/api-auth-dto';
import {InvalidOAuthClientMetadataError, OAuthMetadataFetchError} from './errors.js';
import type {ValidatedOAuthClientMetadata} from './oauth-client.js';
import {
  OAUTH_CIMD_CACHE_MAX_AGE_SECONDS,
  validateOAuthClientId,
  validateOAuthClientMetadataDocument,
} from './oauth-client.js';

export const OAUTH_CIMD_MAX_BODY_BYTES = 256 * 1024;
export const OAUTH_CIMD_FETCH_TIMEOUT_MS = 5_000;

const DECIMAL_RE = /^\d+$/u;
const IPV6_GROUP_RE = /^[0-9a-f]{1,4}$/u;

class CimdTimeoutError extends Error {
  constructor() {
    super('CIMD fetch timed out');
    this.name = 'CimdTimeoutError';
  }
}

export interface CimdAddress {
  address: string;
  family: 4 | 6;
}

export interface CimdHttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
}

export type CimdAddressResolver = (hostname: string) => Promise<readonly CimdAddress[]>;
export type CimdHttpRequester = (params: {
  url: URL;
  address: CimdAddress;
  timeoutMs: number;
  maxBodyBytes: number;
  signal?: AbortSignal;
}) => Promise<CimdHttpResponse>;

export interface FetchedCimdMetadata {
  metadata: ValidatedOAuthClientMetadata;
  cacheMaxAgeSeconds: number;
}

function metadataFetchError(
  reason: OAuthMetadataFetchError['reason'],
  cause?: unknown,
): OAuthMetadataFetchError {
  return new OAuthMetadataFetchError(reason, cause);
}

function ipv4ToNumber(value: string): number | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  let result = 0;
  for (const part of parts) {
    if (!DECIMAL_RE.test(part)) return undefined;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet > 255) return undefined;
    result = result * 256 + octet;
  }
  return result >>> 0;
}

function inIpv4Range(value: number, start: number, end: number): boolean {
  return value >= start && value <= end;
}

function isPublicIpv4(value: string): boolean {
  const address = ipv4ToNumber(value);
  if (address === undefined) return false;
  return !(
    (
      inIpv4Range(address, 0x00000000, 0x00ffffff) || // 0.0.0.0/8
      inIpv4Range(address, 0x0a000000, 0x0affffff) || // 10.0.0.0/8
      inIpv4Range(address, 0x64400000, 0x647fffff) || // 100.64.0.0/10
      inIpv4Range(address, 0x7f000000, 0x7fffffff) || // 127.0.0.0/8
      inIpv4Range(address, 0xa9fe0000, 0xa9feffff) || // 169.254.0.0/16
      inIpv4Range(address, 0xac100000, 0xac1fffff) || // 172.16.0.0/12
      inIpv4Range(address, 0xc0000000, 0xc00000ff) || // 192.0.0.0/24
      inIpv4Range(address, 0xc0000200, 0xc00002ff) || // 192.0.2.0/24
      inIpv4Range(address, 0xc01fc400, 0xc01fc4ff) || // 192.31.196.0/24
      inIpv4Range(address, 0xc034c100, 0xc034c1ff) || // 192.52.193.0/24
      inIpv4Range(address, 0xc0586300, 0xc05863ff) || // 192.88.99.0/24
      inIpv4Range(address, 0xc0a80000, 0xc0a8ffff) || // 192.168.0.0/16
      inIpv4Range(address, 0xc0af3000, 0xc0af30ff) || // 192.175.48.0/24
      inIpv4Range(address, 0xc6120000, 0xc613ffff) || // 198.18.0.0/15
      inIpv4Range(address, 0xc6336400, 0xc63364ff) || // 198.51.100.0/24
      inIpv4Range(address, 0xcb007100, 0xcb0071ff) || // 203.0.113.0/24
      inIpv4Range(address, 0xe0000000, 0xffffffff)
    ) // multicast, reserved, broadcast
  );
}

function parseIpv6(value: string): bigint[] | undefined {
  if (value.includes('%')) return undefined;
  const input = expandEmbeddedIpv4(value.toLowerCase());
  if (input === undefined) return undefined;

  const parts = splitIpv6Groups(input);
  if (parts === undefined) return undefined;
  const {left, right, hasCompression} = parts;

  const groups = hasCompression
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : [...left, ...right];
  if (groups.length !== 8) return undefined;
  return groups.map((part) => BigInt(`0x${part}`));
}

function expandEmbeddedIpv4(value: string): string | undefined {
  if (!value.includes('.')) return value;
  const lastColon = value.lastIndexOf(':');
  if (lastColon < 0) return undefined;
  const ipv4 = ipv4ToNumber(value.slice(lastColon + 1));
  if (ipv4 === undefined) return undefined;
  const high = ((ipv4 >>> 16) & 0xffff).toString(16);
  const low = (ipv4 & 0xffff).toString(16);
  return `${value.slice(0, lastColon)}:${high}:${low}`;
}

function splitIpv6Groups(value: string):
  | {
      hasCompression: boolean;
      left: string[];
      right: string[];
    }
  | undefined {
  const compressionStart = value.indexOf('::');
  if (compressionStart !== -1 && compressionStart !== value.lastIndexOf('::')) {
    return undefined;
  }

  const hasCompression = compressionStart !== -1;
  const [leftText, rightText = ''] = value.split('::');
  const left = leftText ? leftText.split(':') : [];
  const right = rightText ? rightText.split(':') : [];
  if (left.some((part) => !IPV6_GROUP_RE.test(part))) return undefined;
  if (right.some((part) => !IPV6_GROUP_RE.test(part))) return undefined;
  if (!hasCompression && left.length + right.length !== 8) return undefined;
  if (hasCompression && left.length + right.length >= 8) return undefined;
  return {hasCompression, left, right};
}

function isPublicIpv6(value: string): boolean {
  const groups = parseIpv6(value);
  if (!groups) return false;
  const first = Number(groups[0]);
  if (first < 0x2000 || first > 0x3fff) return false;

  // Keep documentation, benchmarking, transition, and other special-use
  // prefixes out of a fetch path even when a resolver returns a routable one.
  if (first === 0x2001) {
    const second = Number(groups[1]);
    if (
      second === 0x0000 ||
      second === 0x0002 ||
      (second >= 0x0010 && second <= 0x002f) ||
      (second >= 0x0db8 && second <= 0x0dbf)
    ) {
      return false;
    }
  }
  if (first === 0x2002 || first === 0x3fff) return false;
  return true;
}

/** Returns true only for a globally routable unicast address. */
export function isPublicUnicastAddress(address: string, family?: 4 | 6): boolean {
  const normalized = address.replace(/^\[|\]$/gu, '');
  const detectedFamily = family ?? (isIP(normalized) as 4 | 6 | 0);
  if (detectedFamily === 4) return isPublicIpv4(normalized);
  if (detectedFamily === 6) return isPublicIpv6(normalized);
  return false;
}

function normalizeHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/gu, '');
}

async function resolvePublicAddress(hostname: string): Promise<readonly CimdAddress[]> {
  if (isIP(hostname) === 4 || isIP(hostname) === 6) {
    const family = isIP(hostname) as 4 | 6;
    if (!isPublicUnicastAddress(hostname, family)) {
      throw metadataFetchError('private-address');
    }
    return [{address: hostname, family}];
  }

  let resolved: Array<{address: string; family: number}>;
  try {
    resolved = await dnsPromises.lookup(hostname, {all: true, verbatim: true});
  } catch (error) {
    throw metadataFetchError('dns-failed', error);
  }
  if (resolved.length === 0) throw metadataFetchError('dns-failed');

  const addresses = resolved.map((entry) => ({
    address: entry.address,
    family: entry.family as 4 | 6,
  }));
  if (
    addresses.some(
      (entry) =>
        (entry.family !== 4 && entry.family !== 6) ||
        !isPublicUnicastAddress(entry.address, entry.family),
    )
  ) {
    throw metadataFetchError('private-address');
  }
  return addresses;
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const normalizedName = name.toLowerCase();
  const headerName = Object.keys(headers).find((key) => key.toLowerCase() === normalizedName);
  const value = headerName === undefined ? undefined : headers[headerName];
  if (Array.isArray(value)) return value.join(', ');
  return value;
}

function parseCacheMaxAge(headers: Record<string, string | string[] | undefined>): number {
  const cacheControl = headerValue(headers, 'cache-control');
  if (!cacheControl) return OAUTH_CIMD_CACHE_MAX_AGE_SECONDS;

  let maxAge: number | undefined;
  for (const directive of cacheControl.split(',')) {
    const [rawName, rawValue] = directive.trim().split('=', 2);
    const name = rawName?.trim().toLowerCase();
    if (name === 'no-store' || name === 'no-cache') return 0;
    if (name === 'max-age' && rawValue !== undefined && DECIMAL_RE.test(rawValue.trim())) {
      maxAge = Number(rawValue.trim());
    }
  }
  return Math.min(maxAge ?? OAUTH_CIMD_CACHE_MAX_AGE_SECONDS, OAUTH_CIMD_CACHE_MAX_AGE_SECONDS);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      reject(new CimdTimeoutError());
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function requestPinnedHttps(params: {
  url: URL;
  address: CimdAddress;
  timeoutMs: number;
  maxBodyBytes: number;
  signal?: AbortSignal;
}): Promise<CimdHttpResponse> {
  return new Promise((resolve, reject) => {
    const hostname = normalizeHostname(params.url);
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = (response: CimdHttpResponse) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };

    if (params.url.protocol !== 'https:' || params.url.username || params.url.password) {
      fail(metadataFetchError('invalid-url'));
      return;
    }

    const request = httpsRequest(
      {
        hostname,
        port: params.url.port || 443,
        path: `${params.url.pathname || '/'}${params.url.search}`,
        method: 'GET',
        headers: {accept: 'application/json'},
        rejectUnauthorized: true,
        servername: hostname,
        timeout: params.timeoutMs,
        signal: params.signal,
        // The address was resolved before this request and is the only value
        // the TLS connection is allowed to use.
        lookup: (_lookupHostname, _options, callback) => {
          callback(null, params.address.address, params.address.family);
        },
      },
      (response) => {
        handleCimdResponse(response, params.maxBodyBytes, fail, succeed);
      },
    );
    request.once('error', (error) => fail(error));
    request.once('timeout', () => {
      request.destroy();
      fail(metadataFetchError('timeout'));
    });
    request.end();
  });
}

function responseHeaderError(
  statusCode: number | undefined,
  headers: Record<string, string | string[] | undefined>,
  maxBodyBytes: number,
): OAuthMetadataFetchError | undefined {
  if (statusCode !== undefined && statusCode >= 300 && statusCode < 400) {
    return metadataFetchError('redirected');
  }
  const contentLength = headerValue(headers, 'content-length');
  if (contentLength !== undefined) {
    if (!DECIMAL_RE.test(contentLength.trim())) return metadataFetchError('invalid-response');
    if (Number(contentLength) > maxBodyBytes) return metadataFetchError('response-too-large');
  }
  const contentEncoding = headerValue(headers, 'content-encoding');
  if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
    return metadataFetchError('invalid-response');
  }
  return undefined;
}

function readCimdResponseBody(response: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buffer.byteLength;
      if (size > maxBodyBytes) {
        response.destroy();
        reject(metadataFetchError('response-too-large'));
        return;
      }
      chunks.push(buffer);
    });
    response.once('error', reject);
    response.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

function handleCimdResponse(
  response: IncomingMessage,
  maxBodyBytes: number,
  fail: (error: unknown) => void,
  succeed: (response: CimdHttpResponse) => void,
): void {
  const headers: Record<string, string | string[] | undefined> = response.headers;
  const headerError = responseHeaderError(response.statusCode, headers, maxBodyBytes);
  if (headerError) {
    response.destroy();
    fail(headerError);
    return;
  }
  void readCimdResponseBody(response, maxBodyBytes).then(
    (body) => succeed({statusCode: response.statusCode ?? 0, headers, body}),
    fail,
  );
}

function parseCimdDocument(body: Uint8Array, clientId: string): ValidatedOAuthClientMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch {
    throw new InvalidOAuthClientMetadataError();
  }

  const result = oauthClientMetadataDocumentSchema.safeParse(parsed);
  if (!result.success) throw new InvalidOAuthClientMetadataError();
  return validateOAuthClientMetadataDocument(result.data, clientId);
}

async function resolvePinnedAddresses(
  hostname: string,
  resolveAddress: CimdAddressResolver,
  timeoutMs: number,
): Promise<readonly CimdAddress[]> {
  let resolved: readonly CimdAddress[];
  try {
    resolved = await withTimeout(resolveAddress(hostname), timeoutMs);
  } catch (error) {
    if (error instanceof OAuthMetadataFetchError) throw error;
    if (error instanceof CimdTimeoutError) throw metadataFetchError('timeout', error);
    throw metadataFetchError('dns-failed', error);
  }
  if (resolved.length === 0) throw metadataFetchError('dns-failed');
  if (
    resolved.some(
      (entry) =>
        (entry.family !== 4 && entry.family !== 6) ||
        !isPublicUnicastAddress(entry.address, entry.family),
    )
  ) {
    throw metadataFetchError('private-address');
  }
  return resolved;
}

async function requestCimdResponse(params: {
  url: URL;
  address: CimdAddress;
  request: CimdHttpRequester;
  timeoutMs: number;
  maxBodyBytes: number;
}): Promise<CimdHttpResponse> {
  const abortController = new AbortController();
  try {
    return await withTimeout(
      params.request({
        url: params.url,
        address: params.address,
        timeoutMs: params.timeoutMs,
        maxBodyBytes: params.maxBodyBytes,
        signal: abortController.signal,
      }),
      params.timeoutMs,
      () => abortController.abort(),
    );
  } catch (error) {
    if (error instanceof OAuthMetadataFetchError) throw error;
    if (error instanceof CimdTimeoutError) throw metadataFetchError('timeout', error);
    throw metadataFetchError('connection-failed', error);
  }
}

function remainingTimeout(deadlineMs: number): number {
  const timeoutMs = deadlineMs - Date.now();
  if (timeoutMs <= 0) throw metadataFetchError('timeout');
  return timeoutMs;
}

function assertCimdResponse(response: CimdHttpResponse, maxBodyBytes: number): void {
  const headerError = responseHeaderError(response.statusCode, response.headers, maxBodyBytes);
  if (headerError) throw headerError;
  if (response.statusCode !== 200) throw metadataFetchError('invalid-response');
  if (response.body.byteLength > maxBodyBytes) {
    throw metadataFetchError('response-too-large');
  }
}

export interface FetchCimdMetadataOptions {
  resolveAddress?: CimdAddressResolver;
  request?: CimdHttpRequester;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

/**
 * Fetches a Client ID Metadata Document after resolving and pinning a public
 * address. This deliberately does not share the general egress helper: CIMD
 * has stricter public-only, no-redirect, and no-credential requirements.
 */
export async function fetchClientIdMetadata(
  clientId: string,
  options: FetchCimdMetadataOptions = {},
): Promise<FetchedCimdMetadata> {
  const url = validateOAuthClientId(clientId);
  const timeoutMs = options.timeoutMs ?? OAUTH_CIMD_FETCH_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? OAUTH_CIMD_MAX_BODY_BYTES;
  const resolveAddress = options.resolveAddress ?? resolvePublicAddress;
  const request = options.request ?? requestPinnedHttps;
  const hostname = normalizeHostname(url);
  const deadlineMs = Date.now() + timeoutMs;

  const addresses = await resolvePinnedAddresses(
    hostname,
    resolveAddress,
    remainingTimeout(deadlineMs),
  );
  let lastConnectionError: OAuthMetadataFetchError | undefined;
  for (const [index, address] of addresses.entries()) {
    try {
      const response = await requestCimdResponse({
        url,
        address,
        request,
        timeoutMs: remainingTimeout(deadlineMs),
        maxBodyBytes,
      });
      assertCimdResponse(response, maxBodyBytes);

      return {
        metadata: parseCimdDocument(response.body, clientId),
        cacheMaxAgeSeconds: parseCacheMaxAge(response.headers),
      };
    } catch (error) {
      if (
        error instanceof OAuthMetadataFetchError &&
        error.reason === 'connection-failed' &&
        index < addresses.length - 1
      ) {
        lastConnectionError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastConnectionError ?? metadataFetchError('connection-failed');
}
