import {access, readFile} from 'node:fs/promises';
import {extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Plugin, ResolvedConfig} from 'vite';

const assetNames = [
  'favicon.ico',
  'favicon.svg',
  'favicon-96x96.png',
  'apple-touch-icon.png',
  'site.webmanifest',
  'web-app-manifest-192x192.png',
  'web-app-manifest-512x512.png',
  // Transactional emails (@shipfox/node-email) link to this asset on the client
  // origin, so every composed client must serve it.
  'email-logo.png',
] as const;

const assetDirectory = fileURLToPath(new URL('../../assets/', import.meta.url));

const contentTypes: Record<string, string> = {
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

export function shipfoxClientManifest(): Plugin {
  let config: ResolvedConfig | undefined;

  function assetPath(name: (typeof assetNames)[number]): string {
    return resolve(assetDirectory, name);
  }

  async function assertNoPublicAssetConflicts(): Promise<void> {
    const publicDirectory = config?.publicDir;
    if (!publicDirectory) return;
    const conflicts = (
      await Promise.all(
        assetNames.map((name) => {
          const publicAsset = resolve(publicDirectory, name);
          if (publicAsset === assetPath(name)) return undefined;
          return access(publicAsset)
            .then(() => name)
            .catch(() => undefined);
        }),
      )
    ).filter((name): name is (typeof assetNames)[number] => name !== undefined);
    if (conflicts.length === 0) return;
    throw new Error(
      `shipfoxClientManifest() owns ${conflicts.map((name) => `/${name}`).join(', ')}. Remove the conflicting files from ${publicDirectory}.`,
    );
  }

  return {
    name: 'shipfox-client-manifest',
    async configResolved(resolvedConfig) {
      config = resolvedConfig;
      await assertNoPublicAssetConflicts();
    },
    async buildStart() {
      if (config?.command !== 'build') return;
      for (const name of assetNames) {
        this.emitFile({type: 'asset', fileName: name, source: await readFile(assetPath(name))});
      }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const name = assetNames.find((assetName) => request.url?.split('?')[0] === `/${assetName}`);
        if (!name) return next();

        try {
          const content = await readFile(assetPath(name));
          response.setHeader(
            'Content-Type',
            contentTypes[extname(name)] ?? 'application/octet-stream',
          );
          response.end(content);
        } catch (error) {
          next(error);
        }
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [
          {tag: 'title', children: 'Shipfox', injectTo: 'head'},
          {
            tag: 'link',
            attrs: {rel: 'icon', type: 'image/png', href: '/favicon-96x96.png', sizes: '96x96'},
            injectTo: 'head',
          },
          {
            tag: 'link',
            attrs: {rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg'},
            injectTo: 'head',
          },
          {tag: 'link', attrs: {rel: 'shortcut icon', href: '/favicon.ico'}, injectTo: 'head'},
          {
            tag: 'link',
            attrs: {rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png'},
            injectTo: 'head',
          },
          {tag: 'link', attrs: {rel: 'manifest', href: '/site.webmanifest'}, injectTo: 'head'},
          {
            tag: 'meta',
            attrs: {name: 'apple-mobile-web-app-title', content: 'Shipfox'},
            injectTo: 'head',
          },
          {tag: 'meta', attrs: {name: 'theme-color', content: '#ff4b00'}, injectTo: 'head'},
        ];
      },
    },
  };
}
