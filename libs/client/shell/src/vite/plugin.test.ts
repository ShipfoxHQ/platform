import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {type Plugin, type ResolvedConfig, build as viteBuild} from 'vite';
import {shipfoxClientManifest} from './manifest.js';
import {shipfoxClientComposition} from './plugin.js';

const fixtureFeatures = fileURLToPath(new URL('../../test/fixtures/features.ts', import.meta.url));
const testDirectory = fileURLToPath(new URL('../../test', import.meta.url));

type HookHandler<T> = T extends {handler: infer Handler} ? Handler : T;
type BuildStartOptions = Parameters<HookHandler<NonNullable<Plugin['buildStart']>>>[0];
type ConfigResolvedHandler = (config: ResolvedConfig) => void | Promise<void>;

function hookHandler<T>(hook: T): HookHandler<T> {
  return (
    typeof hook === 'object' && hook !== null && 'handler' in hook ? hook.handler : hook
  ) as HookHandler<T>;
}

function configResolvedHandler(hook: NonNullable<Plugin['configResolved']>): ConfigResolvedHandler {
  return hookHandler(hook) as ConfigResolvedHandler;
}

function configure(plugin: Plugin, plugins = [plugin]): ReturnType<typeof vi.fn> {
  if (!plugin.configResolved) {
    throw new Error('Expected the composition plugin to implement configResolved.');
  }
  const warn = vi.fn();
  configResolvedHandler(plugin.configResolved)({
    root: process.cwd(),
    plugins,
    logger: {warn} as unknown as ResolvedConfig['logger'],
  } as unknown as ResolvedConfig);
  return warn;
}

function resolveRouteImplementation(source: string): string | undefined {
  const files: Record<string, string> = {
    '#test/default-route-impl.js': join(testDirectory, 'default-route-impl.tsx'),
    '#test/named-route-impl.js': join(testDirectory, 'named-route-impl.tsx'),
    '#test/search-route-impl.js': join(testDirectory, 'search-route-impl.tsx'),
  };
  return files[source];
}

function pluginContext(resolveImplementation = resolveRouteImplementation) {
  const watchedFiles: string[] = [];
  return {
    watchedFiles,
    addWatchFile(file: string) {
      watchedFiles.push(file);
    },
    resolve(source: string) {
      const id = resolveImplementation(source);
      return Promise.resolve(id ? {id} : null);
    },
    environment: {
      pluginContainer: {
        resolveId(source: string) {
          const id = resolveImplementation(source);
          return Promise.resolve(id ? {id} : null);
        },
      },
    },
  };
}

async function build(plugin: Plugin, context: ReturnType<typeof pluginContext>): Promise<void> {
  if (!plugin.buildStart) {
    throw new Error('Expected the composition plugin to implement buildStart.');
  }
  await (
    hookHandler(plugin.buildStart) as unknown as (
      this: typeof context,
      options: BuildStartOptions,
    ) => Promise<void>
  ).call(context, {} as BuildStartOptions);
}

describe('shipfoxClientComposition', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shipfox-client-shell-vite-'));
  });

  afterEach(async () => {
    await rm(directory, {recursive: true, force: true});
  });

  test('warns when the manifest plugin is not registered', () => {
    const plugin = shipfoxClientComposition({features: fixtureFeatures});

    const warn = configure(plugin);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'shipfoxClientComposition() is registered without the "shipfox-client-manifest" plugin (shipfoxClientManifest()).',
      ),
    );
  });

  test('does not warn when the manifest plugin is registered', () => {
    const plugin = shipfoxClientComposition({features: fixtureFeatures});

    const warn = configure(plugin, [plugin, shipfoxClientManifest()]);

    expect(warn).not.toHaveBeenCalled();
  });

  test('generates a static route tree and watches the manifest module graph', async () => {
    const out = join(directory, 'shipfox-app.gen.ts');
    const plugin = shipfoxClientComposition({features: fixtureFeatures, out});
    const context = pluginContext();
    configure(plugin);

    await build(plugin, context);

    await expect(readFile(out, 'utf8')).resolves.toContain(
      'import * as route0Module from "#test/search-route-impl.js";',
    );
    expect(context.watchedFiles).toContain(fixtureFeatures);
  });

  test('fails the Vite build with the shared collision message', async () => {
    const features = join(directory, 'features.ts');
    await writeFile(
      features,
      `export const features = [
  {id: 'shipfox.projects', routes: [{path: '/projects', parent: 'root', impl: '#test/default-route-impl.js'}]},
  {id: 'acme.projects', routes: [{path: '/projects', parent: 'root', impl: '#test/default-route-impl.js'}]},
];`,
    );
    const plugin = shipfoxClientComposition({features, out: join(directory, 'shipfox-app.gen.ts')});
    const context = pluginContext();
    configure(plugin);

    await expect(build(plugin, context)).rejects.toThrow(
      'Route "/projects" is contributed by both features "shipfox.projects" and "acme.projects". Set override: true to replace it explicitly.',
    );
  });

  test('fails the Vite build when a route implementation cannot resolve', async () => {
    const features = join(directory, 'features.ts');
    await writeFile(
      features,
      `export const features = [{id: 'acme.projects', routes: [{path: '/projects', parent: 'root', impl: '#test/missing-route-impl.js'}]}];`,
    );
    const plugin = shipfoxClientComposition({features, out: join(directory, 'shipfox-app.gen.ts')});
    const context = pluginContext();
    configure(plugin);

    await expect(build(plugin, context)).rejects.toThrow(
      'Could not resolve route implementation "#test/missing-route-impl.js" for "/projects".',
    );
  });

  test('generates when Vite resolves a route implementation with a version query', async () => {
    const out = join(directory, 'shipfox-app.gen.ts');
    const plugin = shipfoxClientComposition({features: fixtureFeatures, out});
    const context = pluginContext((source) => {
      if (source === '#test/search-route-impl.js') {
        return `${join(testDirectory, 'search-route-impl.tsx')}?v=abc123`;
      }
      return resolveRouteImplementation(source);
    });
    configure(plugin);

    await build(plugin, context);

    await expect(readFile(out, 'utf8')).resolves.toContain(
      'import * as route0Module from "#test/search-route-impl.js";',
    );
  });

  test('bundles a named-only route module so the runtime export guard can report it', async () => {
    const features = join(directory, 'features.ts');
    const implementation = join(directory, 'not-route-impl.ts');
    const output = join(directory, 'shipfox-app.gen.ts');
    const entry = join(directory, 'main.ts');
    await Promise.all([
      writeFile(
        features,
        `export const features = [{id: 'acme.projects', routes: [{path: '/projects', parent: 'root', impl: './not-route-impl.ts'}]}];`,
      ),
      writeFile(implementation, 'export const Route = () => null;'),
      writeFile(entry, "import './shipfox-app.gen.ts';"),
    ]);

    await expect(
      viteBuild({
        root: process.cwd(),
        logLevel: 'silent',
        plugins: [shipfoxClientComposition({features, out: output})],
        build: {
          write: false,
          rolldownOptions: {
            input: entry,
            external: ['@shipfox/client-shell/runtime', '@tanstack/react-router'],
          },
        },
      }),
    ).resolves.toBeDefined();
    await expect(readFile(output, 'utf8')).resolves.toContain(
      'routeOptions(route0Module.default, "./not-route-impl.ts", "/projects")',
    );
  });

  test('regenerates when a watched manifest changes', async () => {
    const features = join(directory, 'features.ts');
    const contribution = join(directory, 'contribution.ts');
    const out = join(directory, 'shipfox-app.gen.ts');
    await writeFile(
      features,
      `import {feature} from './contribution.ts';
export const features = [feature];`,
    );
    await writeFile(
      contribution,
      `export const feature = {id: 'acme.insights', routes: [{path: '/insights', parent: 'root', impl: '#test/default-route-impl.js'}]};`,
    );
    const plugin = shipfoxClientComposition({features, out});
    const context = pluginContext();
    configure(plugin);

    await build(plugin, context);
    expect(context.watchedFiles).toContain(await realpath(contribution));
    await writeFile(
      contribution,
      `export const feature = {id: 'acme.reports', routes: [{path: '/reports', parent: 'root', impl: '#test/default-route-impl.js'}]};`,
    );
    const hotUpdateContext = {environment: context.environment};
    await (
      plugin.hotUpdate as unknown as (
        this: typeof hotUpdateContext,
        options: {
          file: string;
          server: {watcher: {add(file: string): void}};
        },
      ) => Promise<void>
    ).call(hotUpdateContext, {
      file: contribution,
      server: {
        watcher: {
          add(file: string) {
            context.watchedFiles.push(file);
          },
        },
      },
    });

    await expect(readFile(out, 'utf8')).resolves.toContain('path: "/reports"');
  });
});
