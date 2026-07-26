import {readFile, stat} from 'node:fs/promises';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {dirname, extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {storybookManifest} from '../preview-manifest.js';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staticRoot = resolve(appRoot, 'storybook-output');
const port = Number(process.env.STORYBOOK_PREVIEW_PORT ?? 4173);
const host = process.env.STORYBOOK_PREVIEW_HOST ?? '127.0.0.1';
const leadingSlashPattern = /^\//;

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function sendResponse(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(body);
}

function isChildPath(pathname: string): boolean {
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  return firstSegment !== undefined && storybookManifest.some(({id}) => id === firstSegment);
}

function resolveRequestPath(pathname: string): string {
  const decodedPath = decodeURIComponent(pathname);
  const candidate = resolve(staticRoot, `.${decodedPath}`);
  if (candidate === staticRoot || candidate.startsWith(`${staticRoot}${sep}`)) return candidate;
  throw new Error('request path escapes the preview artifact');
}

async function findFile(pathname: string): Promise<string | null> {
  const candidate = resolveRequestPath(pathname);

  try {
    const candidateStats = await stat(candidate);
    if (candidateStats.isFile()) return candidate;
    if (candidateStats.isDirectory()) {
      const indexPath = resolve(candidate, 'index.html');
      return (await stat(indexPath)).isFile() ? indexPath : null;
    }
  } catch {
    // Storybook uses client-side routes for deep links without a file extension.
  }

  if (pathname.includes('.')) return null;
  return resolve(
    staticRoot,
    isChildPath(pathname)
      ? `${pathname.replace(leadingSlashPattern, '')}/index.html`
      : 'index.html',
  );
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendResponse(response, 405, 'Method Not Allowed');
    return;
  }

  try {
    const requestUrl = new URL(request.url ?? '/', `http://${host}:${port}`);
    const filePath = await findFile(requestUrl.pathname);
    if (filePath === null) {
      sendResponse(response, 404, 'Not Found');
      return;
    }

    const body = await readFile(filePath);
    response.statusCode = 200;
    response.setHeader(
      'content-type',
      contentTypes[extname(filePath)] ?? 'application/octet-stream',
    );
    response.setHeader('content-length', body.byteLength);
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    sendResponse(response, 400, error instanceof Error ? error.message : 'Bad Request');
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(port, host, () => {
  process.stdout.write(`Serving ${staticRoot} at http://${host}:${port}\n`);
});
