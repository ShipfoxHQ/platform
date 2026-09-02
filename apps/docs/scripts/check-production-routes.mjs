import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';

const appDirectory = fileURLToPath(new URL('..', import.meta.url));
const addressInUsePattern = /EADDRINUSE|address already in use/i;
const basePath = '/docs';
const browserAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const canonicalOrigin = 'https://docs-route-check.shipfox.test';
const htmlTitlePattern = /<title>([\s\S]*?)<\/title>/;
const markdownHeadingPattern = /^# (.+) \((https?:\/\/[^)\n]+)\)\n\n/;
const requestTimeoutMilliseconds = 15_000;
const productionEnvironment = {
  ...process.env,
  VERCEL_ENV: 'production',
  NEXT_PUBLIC_VERCEL_ENV: 'production',
  NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: new URL(canonicalOrigin).host,
  NEXT_PUBLIC_POSTHOG_KEY: 'docs-production-route-check',
  NEXT_PUBLIC_POSTHOG_URL: 'https://ph.shipfox.io',
};

function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForServer(origin, child, readLogs) {
  const deadline = Date.now() + 30_000;
  let lastConnectionError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Docs server stopped before it was ready.\n${readLogs()}`);
    try {
      const response = await fetch(`${origin}${basePath}`, {
        signal: AbortSignal.timeout(1_000),
      });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch (error) {
      lastConnectionError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Docs server did not become ready.\n${readLogs()}`, {
    cause: lastConnectionError,
  });
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function request(origin, path, accept) {
  try {
    const response = await fetch(`${origin}${path}`, {
      headers: accept ? {accept} : undefined,
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      vary: response.headers.get('vary') ?? '',
      body: Buffer.from(await response.arrayBuffer()),
    };
  } catch (error) {
    throw new Error(`${path}: request did not complete within ${requestTimeoutMilliseconds}ms`, {
      cause: error,
    });
  }
}

function assertResponse(response, expected, label) {
  assert.equal(response.status, expected.status, `${label}: unexpected status`);
  assert(
    response.contentType.toLowerCase().startsWith(expected.contentType.toLowerCase()),
    `${label}: expected ${expected.contentType}, received ${response.contentType || '<none>'}`,
  );
}

function assertAcceptDoesNotVary(response, label) {
  const vary = response.vary
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  assert(!vary.includes('accept'), `${label}: disabled negotiation must not vary on Accept`);
}

function docsPagesFromSitemap(body) {
  const pages = [...body.toString('utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, location]) => {
    const canonicalUrl = new URL(location);
    assert.equal(
      canonicalUrl.origin,
      canonicalOrigin,
      `The production sitemap uses an unexpected origin for ${canonicalUrl.pathname}`,
    );
    assert.equal(canonicalUrl.search, '', `${location}: sitemap URL must not contain a query`);
    assert.equal(canonicalUrl.hash, '', `${location}: sitemap URL must not contain a fragment`);
    return {canonicalUrl: canonicalUrl.toString(), path: canonicalUrl.pathname};
  });
  assert(pages.length > 0, 'The production sitemap contains no docs pages');
  assert(
    pages.every(({path}) => path === basePath || path.startsWith(`${basePath}/`)),
    'The production sitemap contains a page outside the docs base path',
  );
  return pages;
}

function decodeHtmlEntities(value) {
  const namedEntities = new Map([
    ['amp', '&'],
    ['apos', "'"],
    ['gt', '>'],
    ['lt', '<'],
    ['quot', '"'],
  ]);
  return value.replaceAll(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, name) => {
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return namedEntities.get(name.toLowerCase()) ?? entity;
  });
}

function assertPageIdentity(htmlResponse, markdownResponse, page, markdownPath) {
  const markdown = markdownResponse.body.toString('utf8');
  const markdownHeading = markdownHeadingPattern.exec(markdown);
  assert(
    markdownHeading,
    `${markdownPath}: direct Markdown does not start with its title and canonical URL`,
  );
  assert.equal(
    markdownHeading[2],
    page.canonicalUrl,
    `${markdownPath}: direct Markdown canonical URL does not identify ${page.path}`,
  );

  const htmlTitle = htmlTitlePattern.exec(htmlResponse.body.toString('utf8'));
  assert(htmlTitle, `${page.path}: HTML response does not contain a title`);
  assert.equal(
    decodeHtmlEntities(htmlTitle[1]),
    `${markdownHeading[1]} | Shipfox`,
    `${page.path}: HTML and direct Markdown identify different pages`,
  );
}

async function assertHtmlSequence(origin, path, order, status = 200) {
  const query = `route-check=${order}`;
  const separator = path.includes('?') ? '&' : '?';
  const requestPath = `${path}${separator}${query}`;
  const acceptValues =
    order === 'html-first'
      ? [browserAccept, 'text/markdown', browserAccept]
      : ['text/markdown', browserAccept, 'text/markdown'];
  const responses = [];

  for (const accept of acceptValues) {
    const response = await request(origin, requestPath, accept);
    assertResponse(response, {status, contentType: 'text/html'}, `${path} (${order})`);
    assertAcceptDoesNotVary(response, `${path} (${order})`);
    responses.push(response);
  }

  assert(
    responses[0].body.equals(responses[1].body),
    `${path} (${order}): response changed by Accept`,
  );
  assert(
    responses[0].body.equals(responses[2].body),
    `${path} (${order}): repeated response changed`,
  );
  return responses[0];
}

async function assertStableRoute(origin, route) {
  const browserResponse = await request(origin, route.path, browserAccept);
  const markdownAcceptResponse = await request(origin, route.path, 'text/markdown');
  assertResponse(browserResponse, route, `${route.path} (browser)`);
  assertResponse(markdownAcceptResponse, route, `${route.path} (Markdown Accept)`);
  assert(
    browserResponse.body.equals(markdownAcceptResponse.body),
    `${route.path}: excluded route changed by Accept`,
  );
}

function spawnDocsServer(port) {
  let serverLogs = '';
  const child = spawn(
    'mise',
    ['exec', '--', 'pnpm', 'exec', 'next', 'start', '--port', String(port)],
    {
      cwd: appDirectory,
      env: productionEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      serverLogs = `${serverLogs}${chunk}`.slice(-20_000);
    });
  }
  return {child, readLogs: () => serverLogs};
}

async function startDocsServer() {
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const port = await findAvailablePort();
    const origin = `http://127.0.0.1:${port}`;
    const server = spawnDocsServer(port);
    try {
      await waitForServer(origin, server.child, server.readLogs);
      return {...server, origin};
    } catch (error) {
      const addressWasClaimed = addressInUsePattern.test(server.readLogs());
      await stopServer(server.child);
      if (!addressWasClaimed || attempt === maximumAttempts) throw error;
    }
  }
  throw new Error('Docs server could not reserve a local port');
}

await run('mise', ['exec', '--', 'pnpm', 'exec', 'next', 'build'], {
  cwd: appDirectory,
  env: productionEnvironment,
  stdio: 'inherit',
});

const docsServer = await startDocsServer();

try {
  const sitemap = await request(docsServer.origin, `${basePath}/sitemap.xml`);
  assertResponse(sitemap, {status: 200, contentType: 'application/xml'}, `${basePath}/sitemap.xml`);
  const pages = docsPagesFromSitemap(sitemap.body);
  for (const page of pages) {
    const markdownPath = page.path === basePath ? `${basePath}/index.md` : `${page.path}.md`;

    const htmlResponse = await assertHtmlSequence(docsServer.origin, page.path, 'html-first');
    await assertHtmlSequence(docsServer.origin, page.path, 'markdown-first');

    const browserMarkdown = await request(docsServer.origin, markdownPath, browserAccept);
    const acceptedMarkdown = await request(docsServer.origin, markdownPath, 'text/markdown');
    assertResponse(
      browserMarkdown,
      {status: 200, contentType: 'text/markdown'},
      `${markdownPath} (browser)`,
    );
    assertResponse(
      acceptedMarkdown,
      {status: 200, contentType: 'text/markdown'},
      `${markdownPath} (Markdown Accept)`,
    );
    assert(
      browserMarkdown.body.equals(acceptedMarkdown.body),
      `${markdownPath}: direct Markdown changed by Accept`,
    );
    assertPageIdentity(htmlResponse, browserMarkdown, page, markdownPath);
  }

  const excludedRoutes = [
    {path: `${basePath}/llms.txt`, status: 200, contentType: 'text/plain'},
    {path: `${basePath}/llms-full.txt`, status: 200, contentType: 'text/plain'},
    {path: `${basePath}/api/search?query=workflow`, status: 200, contentType: 'application/json'},
    {path: `${basePath}/sitemap.xml`, status: 200, contentType: 'application/xml'},
    {path: `${basePath}/robots.txt`, status: 200, contentType: 'text/plain'},
    {
      path: `${basePath}/llms.mdx/getting-started`,
      status: 200,
      contentType: 'text/markdown',
    },
    {path: `${basePath}/shipfox-og.jpg`, status: 200, contentType: 'image/jpeg'},
    {path: `${basePath}/logo.svg`, status: 200, contentType: 'image/svg+xml'},
    {path: `${basePath}/img/create-project.png`, status: 200, contentType: 'image/png'},
    {path: `${basePath}/icon.png`, status: 200, contentType: 'image/png'},
    {
      path: `${basePath}/workflow.schema.json`,
      status: 200,
      contentType: 'application/json',
    },
  ];
  for (const route of excludedRoutes) await assertStableRoute(docsServer.origin, route);

  await assertHtmlSequence(
    docsServer.origin,
    `${basePath}/route-that-does-not-exist`,
    'html-first',
    404,
  );
  await assertHtmlSequence(
    docsServer.origin,
    `${basePath}/route-that-does-not-exist`,
    'markdown-first',
    404,
  );

  process.stdout.write(
    `✓ production route matrix: ${pages.length} HTML pages, ${pages.length} direct Markdown pages, and ${excludedRoutes.length} excluded routes`,
  );
  process.stdout.write(
    '\n✓ content negotiation is disabled; HTML and error responses are stable in both orders\n',
  );
} finally {
  await stopServer(docsServer.child);
}
