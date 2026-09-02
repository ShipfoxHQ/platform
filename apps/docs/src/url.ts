import {config, type loadConfig} from './config';

const LOCAL_DOCS_ORIGIN = 'http://localhost:3500';
export const PUBLIC_DOCS_ORIGIN = 'https://www.shipfox.io';

type DocsConfig = ReturnType<typeof loadConfig>;
type DocsEnvironment = Partial<
  Pick<
    DocsConfig,
    'VERCEL_ENV' | 'VERCEL_URL' | 'NEXT_PUBLIC_VERCEL_ENV' | 'NEXT_PUBLIC_VERCEL_URL'
  >
>;

function originFromDeploymentHost(host: string): string {
  const value = host.includes('://') ? host : `https://${host}`;
  return new URL(value).origin;
}

export function resolveDocsOrigin(environment: DocsEnvironment = config): string {
  const deploymentEnvironment = environment.VERCEL_ENV ?? environment.NEXT_PUBLIC_VERCEL_ENV;
  if (deploymentEnvironment === 'production') return PUBLIC_DOCS_ORIGIN;

  const deploymentHost = environment.VERCEL_URL ?? environment.NEXT_PUBLIC_VERCEL_URL;
  if (deploymentHost) return originFromDeploymentHost(deploymentHost);

  return LOCAL_DOCS_ORIGIN;
}

export const url = resolveDocsOrigin();

// Set from `basePath` in next.config.mjs (via NEXT_PUBLIC_BASE_PATH): `/docs` in
// production, empty in local dev. Every absolute URL we emit for external consumers
// (llms.txt, sitemap, robots, OG metadata) must carry the prefix; Next only applies
// basePath to in-app routing, not to strings we build ourselves.
export const basePath = config.NEXT_PUBLIC_BASE_PATH;

export const toUrl = (path: string, origin: string = url, prefix: string = basePath) => {
  const suffix = path === '/' ? '' : path;
  return new URL(`${prefix}${suffix}`, origin).toString();
};

export const toMarkdownUrl = (path: string, origin: string = url, prefix: string = basePath) => {
  const markdownPath = path === '/' ? '/index.md' : `${path}.md`;
  return toUrl(markdownPath, origin, prefix);
};
