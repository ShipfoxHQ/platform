import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {buildAnthropicError, buildAnthropicMessageStream} from './anthropic.js';
import {buildChatCompletionChunks, buildOpenAiError, buildOpenAiModelList} from './openai.js';
import {type FakeOpenAiScript, FakeOpenAiScriptRegistry} from './scripts.js';

export interface FakeOpenAiModelProviderServer {
  adminToken: string;
  baseUrl: string;
  registry: FakeOpenAiScriptRegistry;
  stop(): Promise<void>;
}

export interface CreateFakeOpenAiModelProviderServerParams {
  adminToken?: string | undefined;
  registry?: FakeOpenAiScriptRegistry | undefined;
}

const host = '127.0.0.1';
const maxBodyBytes = 1024 * 1024;
const resetPathRe = /^\/scripts\/([^/]+)\/reset$/u;
const requestsPathRe = /^\/scripts\/([^/]+)\/requests$/u;
const completionsPathRe = /^\/scripts\/([^/]+)\/v1\/chat\/completions$/u;
const messagesPathRe = /^\/scripts\/([^/]+)\/v1\/messages$/u;
const modelsPathRe = /^\/scripts\/([^/]+)\/v1\/models$/u;

export async function createFakeOpenAiModelProviderServer(
  params: CreateFakeOpenAiModelProviderServerParams = {},
): Promise<FakeOpenAiModelProviderServer> {
  const adminToken = params.adminToken ?? crypto.randomUUID();
  const registry = params.registry ?? new FakeOpenAiScriptRegistry();
  const server = createServer((request, response) => {
    void routeRequest({adminToken, registry, request, response});
  });

  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fake model provider did not bind a TCP port.');

  return {
    adminToken,
    baseUrl: `http://${host}:${address.port}`,
    registry,
    stop: async () => {
      await close(server);
    },
  };
}

interface RouteParams {
  adminToken: string;
  registry: FakeOpenAiScriptRegistry;
  request: IncomingMessage;
  response: ServerResponse;
}

interface RequestRoute {
  method: string;
  pathname: string;
  url: URL;
}

function authorizeAdminRoute(params: RouteParams): boolean {
  if (isAuthorized(params.request, params.adminToken)) return true;
  writeUnauthorized(params.response);
  return false;
}

function handleHealthRoute(params: RouteParams, route: RequestRoute): boolean {
  if (route.pathname !== '/healthz' || route.method !== 'GET') return false;
  if (authorizeAdminRoute(params)) writeJson(params.response, 200, {ok: true});
  return true;
}

async function handleScriptRegistration(
  params: RouteParams,
  route: RequestRoute,
): Promise<boolean> {
  if (route.pathname !== '/scripts' || route.method !== 'POST') return false;
  if (!authorizeAdminRoute(params)) return true;

  const script = await readJson<FakeOpenAiScript>(params.request);
  validateScriptRegistration(script);
  const result = params.registry.register(script);
  writeJson(params.response, 201, {
    script_id: result.scriptId,
    model: result.model,
    model_provider_base_url: `${origin(route.url)}/scripts/${result.scriptId}/v1`,
    anthropic_model_provider_base_url: `${origin(route.url)}/scripts/${result.scriptId}`,
  });
  return true;
}

function handleScriptReset(params: RouteParams, route: RequestRoute): boolean {
  const match = resetPathRe.exec(route.pathname);
  if (!match || route.method !== 'POST') return false;
  if (!authorizeAdminRoute(params)) return true;

  params.registry.reset(decodeURIComponent(match[1] ?? ''));
  params.response.statusCode = 204;
  params.response.end();
  return true;
}

function handleRecordedRequests(params: RouteParams, route: RequestRoute): boolean {
  const match = requestsPathRe.exec(route.pathname);
  if (!match || route.method !== 'GET') return false;
  if (!authorizeAdminRoute(params)) return true;

  const scriptId = decodeURIComponent(match[1] ?? '');
  writeJson(params.response, 200, {
    script_id: scriptId,
    requests: params.registry.requests(scriptId),
  });
  return true;
}

async function handleChatCompletion(params: RouteParams, route: RequestRoute): Promise<boolean> {
  const match = completionsPathRe.exec(route.pathname);
  if (!match || route.method !== 'POST') return false;

  const scriptId = decodeURIComponent(match[1] ?? '');
  const body = await readJson(params.request);
  const result = params.registry.advance(scriptId, {
    body,
    method: route.method,
    path: route.pathname,
  });
  if (result.status === 200 && isStreamRequest(body) && isChatCompletion(result.body)) {
    writeEventStream(params.response, buildChatCompletionChunks(result.body));
  } else {
    writeJson(params.response, result.status, result.body);
  }
  return true;
}

async function handleAnthropicMessage(params: RouteParams, route: RequestRoute): Promise<boolean> {
  const match = messagesPathRe.exec(route.pathname);
  if (!match || route.method !== 'POST') return false;

  const scriptId = decodeURIComponent(match[1] ?? '');
  const body = await readJson(params.request);
  const result = params.registry.advanceAnthropic(scriptId, {
    body,
    method: route.method,
    path: route.pathname,
  });
  if (result.status === 200 && isStreamRequest(body) && isAnthropicMessage(result.body)) {
    writeNamedEventStream(params.response, buildAnthropicMessageStream(result.body));
  } else {
    writeJson(params.response, result.status, result.body);
  }
  return true;
}

function handleModelList(params: RouteParams, route: RequestRoute): boolean {
  const match = modelsPathRe.exec(route.pathname);
  if (!match || route.method !== 'GET') return false;
  const script = params.registry.script(decodeURIComponent(match[1] ?? ''));
  writeJson(params.response, 200, buildOpenAiModelList(script.model));
  return true;
}

async function dispatchRequest(params: RouteParams, route: RequestRoute): Promise<void> {
  if (handleHealthRoute(params, route)) return;
  if (await handleScriptRegistration(params, route)) return;
  if (handleScriptReset(params, route)) return;
  if (handleRecordedRequests(params, route)) return;
  if (await handleChatCompletion(params, route)) return;
  if (await handleAnthropicMessage(params, route)) return;
  if (handleModelList(params, route)) return;

  writeJson(
    params.response,
    404,
    buildOpenAiError('not_found', `Route not found: ${route.method} ${route.pathname}`),
  );
}

async function routeRequest(params: RouteParams): Promise<void> {
  try {
    const url = requestUrl(params.request);
    await dispatchRequest(params, {
      method: params.request.method ?? 'GET',
      pathname: url.pathname,
      url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fake model provider request failed.';
    writeJson(
      params.response,
      400,
      buildBadRequestBody(requestUrl(params.request).pathname, message),
    );
  }
}

function requestUrl(request: IncomingMessage): URL {
  const hostHeader = request.headers.host ?? `${host}:0`;
  return new URL(request.url ?? '/', `http://${hostHeader}`);
}

function origin(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function isAuthorized(request: IncomingMessage, adminToken: string): boolean {
  return request.headers.authorization === `Bearer ${adminToken}`;
}

function writeUnauthorized(response: ServerResponse): void {
  writeJson(response, 401, buildOpenAiError('unauthorized', 'Missing or invalid admin token'));
}

function isStreamRequest(body: unknown): boolean {
  return Boolean(body && typeof body === 'object' && (body as {stream?: unknown}).stream === true);
}

function isChatCompletion(body: unknown): body is Parameters<typeof buildChatCompletionChunks>[0] {
  return Boolean(
    body && typeof body === 'object' && (body as {object?: unknown}).object === 'chat.completion',
  );
}

function isAnthropicMessage(
  body: unknown,
): body is Parameters<typeof buildAnthropicMessageStream>[0] {
  return Boolean(body && typeof body === 'object' && (body as {type?: unknown}).type === 'message');
}

function validateScriptRegistration(script: FakeOpenAiScript): void {
  if (!script || typeof script !== 'object') throw new Error('Script body must be an object.');
  if (!isNonEmptyString(script.id)) throw new Error('Script id must be a non-empty string.');
  if (!isNonEmptyString(script.model)) throw new Error('Script model must be a non-empty string.');
  if (!Array.isArray(script.responses)) throw new Error('Script responses must be an array.');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

async function readJson<T = unknown>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBodyBytes) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }

  if (chunks.length === 0) throw new Error('Request body is required.');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

function writeEventStream(response: ServerResponse, chunks: unknown[]): void {
  response.statusCode = 200;
  response.setHeader('content-type', 'text/event-stream; charset=utf-8');
  response.setHeader('cache-control', 'no-cache');
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.end('data: [DONE]\n\n');
}

function writeNamedEventStream(
  response: ServerResponse,
  events: Array<{event: string; data: unknown}>,
): void {
  response.statusCode = 200;
  response.setHeader('content-type', 'text/event-stream; charset=utf-8');
  response.setHeader('cache-control', 'no-cache');
  for (const event of events) {
    response.write(`event: ${event.event}\n`);
    response.write(`data: ${JSON.stringify(event.data)}\n\n`);
  }
  response.end();
}

function buildBadRequestBody(pathname: string, message: string): unknown {
  return messagesPathRe.test(pathname)
    ? buildAnthropicError('bad_request', message)
    : buildOpenAiError('bad_request', message);
}

async function listen(server: Server): Promise<AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fake model provider did not bind a TCP port.');
  return address;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
