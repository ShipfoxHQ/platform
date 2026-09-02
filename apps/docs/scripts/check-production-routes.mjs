import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';

const appDirectory = fileURLToPath(new URL('..', import.meta.url));
const basePath = '/docs';
const browserAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const productionEnvironment = {
  ...process.env,
  VERCEL_ENV: 'production',
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
    if (child.exitCode !== null)
      throw new Error(`Docs server stopped before it was ready.\n${readLogs()}`);
    try {
      const response = await fetch(`${origin}${basePath}`);
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
  if (child.exitCode !== null) return;
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
  const response = await fetch(`${origin}${path}`, {
    headers: accept ? {accept} : undefined,
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    vary: response.headers.get('vary') ?? '',
    body: Buffer.from(await response.arrayBuffer()),
  };
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
  const pagePaths = [...body.toString('utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    ([, location]) => new URL(location).pathname,
  );
  assert(pagePaths.length > 0, 'The production sitemap contains no docs pages');
  assert(
    pagePaths.every((path) => path === basePath || path.startsWith(`${basePath}/`)),
    'The production sitemap contains a page outside the docs base path',
  );
  return pagePaths;
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

await run('pnpm', ['build'], {
  cwd: appDirectory,
  env: productionEnvironment,
  stdio: 'inherit',
});

const port = await findAvailablePort();
const origin = `http://127.0.0.1:${port}`;
let serverLogs = '';
const docsServer = spawn('pnpm', ['exec', 'next', 'start', '--port', String(port)], {
  cwd: appDirectory,
  env: productionEnvironment,
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [docsServer.stdout, docsServer.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    serverLogs = `${serverLogs}${chunk}`.slice(-20_000);
  });
}

try {
  await waitForServer(origin, docsServer, () => serverLogs);

  const sitemap = await request(origin, `${basePath}/sitemap.xml`);
  assertResponse(sitemap, {status: 200, contentType: 'application/xml'}, `${basePath}/sitemap.xml`);
  const pagePaths = docsPagesFromSitemap(sitemap.body);
  for (const htmlPath of pagePaths) {
    const markdownPath = htmlPath === basePath ? `${basePath}/index.md` : `${htmlPath}.md`;

    await assertHtmlSequence(origin, htmlPath, 'html-first');
    await assertHtmlSequence(origin, htmlPath, 'markdown-first');

    const browserMarkdown = await request(origin, markdownPath, browserAccept);
    const acceptedMarkdown = await request(origin, markdownPath, 'text/markdown');
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
    assert(
      /^# .+ \(.+\)\n\n/.test(browserMarkdown.body.toString('utf8')),
      `${markdownPath}: direct Markdown does not start with its title and canonical URL`,
    );
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
  for (const route of excludedRoutes) await assertStableRoute(origin, route);

  await assertHtmlSequence(origin, `${basePath}/route-that-does-not-exist`, 'html-first', 404);
  await assertHtmlSequence(origin, `${basePath}/route-that-does-not-exist`, 'markdown-first', 404);

  process.stdout.write(
    `✓ production route matrix: ${pagePaths.length} HTML pages, ${pagePaths.length} direct Markdown pages, and ${excludedRoutes.length} excluded routes`,
  );
  process.stdout.write(
    '\n✓ content negotiation is disabled; HTML and error responses are stable in both orders\n',
  );
} finally {
  await stopServer(docsServer);
}
