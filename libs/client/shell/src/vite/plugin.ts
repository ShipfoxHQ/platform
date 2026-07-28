import {mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import type {Plugin, ResolvedConfig} from 'vite';
import {composeClientFeatures} from '#compose/compose-client-features.js';
import {evaluateFeatures} from './evaluate-features.js';
import {generateAppModule} from './generate.js';

const manifestPluginName = 'shipfox-client-manifest';

export interface ShipfoxClientCompositionOptions {
  features: string;
  out?: string;
}

type RouteResolver = (source: string, importer?: string) => Promise<{id: string} | null>;

export function shipfoxClientComposition({
  features,
  out = './src/shipfox-app.gen.ts',
}: ShipfoxClientCompositionOptions): Plugin {
  let config: ResolvedConfig | undefined;
  let watchedFiles = new Set<string>();

  const outputPath = () => resolve(config?.root ?? process.cwd(), out);
  const featuresPath = () => resolve(config?.root ?? process.cwd(), features);

  async function assertRoutesResolve(
    resolveRoute: RouteResolver,
    routes: ReturnType<typeof composeClientFeatures>['routes'],
    layouts: ReturnType<typeof composeClientFeatures>['layouts'],
  ): Promise<void> {
    for (const route of [...layouts, ...routes]) {
      const resolvedRoute = await resolveRoute(route.impl, outputPath());
      if (!resolvedRoute) {
        throw new Error(
          `Could not resolve route implementation "${route.impl}" for "${route.path}".`,
        );
      }
    }
  }

  async function generate({
    addWatchFile,
    resolveRoute,
  }: {
    addWatchFile(file: string): void;
    resolveRoute: RouteResolver;
  }): Promise<void> {
    const evaluated = await evaluateFeatures(featuresPath());
    const composition = composeClientFeatures(evaluated.features);
    await assertRoutesResolve(resolveRoute, composition.routes, composition.layouts);

    watchedFiles = new Set(evaluated.loadedFiles);
    for (const file of watchedFiles) addWatchFile(file);

    const output = generateAppModule({
      layouts: composition.layouts,
      routes: composition.routes,
      navigation: composition.navigation,
      settingsSections: composition.settingsSections,
    });
    const path = outputPath();
    const existing = await readFile(path, 'utf8').catch(() => undefined);
    if (existing === output) return;
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, output);
  }

  return {
    name: 'shipfox-client-composition',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
      if (!resolvedConfig.plugins.some(({name}) => name === manifestPluginName)) {
        resolvedConfig.logger.warn(
          `shipfoxClientComposition() is registered without the "${manifestPluginName}" plugin (shipfoxClientManifest()). Add shipfoxClientManifest() to the Vite plugins to serve Shipfox branding assets.`,
        );
      }
    },
    async buildStart() {
      await generate({
        addWatchFile: this.addWatchFile.bind(this),
        resolveRoute: this.resolve.bind(this),
      });
    },
    async hotUpdate({file, server}) {
      const resolvedFile = await realpath(file).catch(() => resolve(file));
      if (!watchedFiles.has(resolvedFile)) return;
      await generate({
        addWatchFile: server.watcher.add.bind(server.watcher),
        resolveRoute: this.environment.pluginContainer.resolveId.bind(
          this.environment.pluginContainer,
        ),
      });
    },
  };
}
