import {randomUUID} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {register} from 'tsx/cjs/api';
import type {ClientFeature} from '#contract.js';

const require = createRequire(import.meta.url);
const nodeModulesPathPattern = /[\\/]node_modules[\\/]/;

export interface EvaluatedFeatures {
  features: readonly ClientFeature[];
  loadedFiles: readonly string[];
}

function loadedModuleGraph(namespaceQuery: string): {
  cacheKeys: Set<string>;
  loadedPaths: Set<string>;
} {
  const cacheKeys = new Set<string>();
  const loadedPaths = new Set<string>();
  const keysByModule = new Map<NodeJS.Module, string[]>();

  for (const [cacheKey, cachedModule] of Object.entries(require.cache)) {
    if (!cachedModule) continue;
    const keys = keysByModule.get(cachedModule) ?? [];
    keys.push(cacheKey);
    keysByModule.set(cachedModule, keys);
  }

  const visited = new Set<NodeJS.Module>();
  function visit(cachedModule: NodeJS.Module): void {
    if (visited.has(cachedModule)) return;
    visited.add(cachedModule);
    recordLoadedModuleKeys(
      keysByModule.get(cachedModule) ?? [],
      namespaceQuery,
      cacheKeys,
      loadedPaths,
    );
    for (const child of cachedModule.children) visit(child);
  }

  for (const [cacheKey, cachedModule] of Object.entries(require.cache)) {
    if (cachedModule && cacheKey.endsWith(namespaceQuery)) visit(cachedModule);
  }

  return {cacheKeys, loadedPaths};
}

function recordLoadedModuleKeys(
  moduleKeys: readonly string[],
  namespaceQuery: string,
  cacheKeys: Set<string>,
  loadedPaths: Set<string>,
): void {
  for (const cacheKey of moduleKeys) {
    const namespaced = cacheKey.endsWith(namespaceQuery);
    const path = namespaced ? cacheKey.slice(0, -namespaceQuery.length) : cacheKey;
    const isLocal = !nodeModulesPathPattern.test(path);
    if (isLocal) loadedPaths.add(path);
    if (isLocal || namespaced) cacheKeys.add(cacheKey);
  }
}

async function localFiles(paths: Iterable<string>): Promise<string[]> {
  const files = new Set<string>();
  for (const path of paths) {
    if (nodeModulesPathPattern.test(path)) continue;
    files.add(await realpath(path).catch(() => path));
  }
  return [...files];
}

export async function evaluateFeatures(featuresModule: string): Promise<EvaluatedFeatures> {
  const resolvedFeaturesModule = await realpath(resolve(featuresModule));
  const namespace = randomUUID();
  const namespaceQuery = `?namespace=${namespace}`;
  const loader = register({namespace});
  const loadedPaths = new Set<string>([resolvedFeaturesModule]);
  const cacheKeys = new Set<string>();
  const initialCacheKeys = new Set(Object.keys(require.cache));
  let module: {default?: unknown; features?: unknown};
  try {
    module = loader.require(resolvedFeaturesModule, import.meta.url) as {
      default?: unknown;
      features?: unknown;
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to evaluate features module "${resolvedFeaturesModule}". Features modules must be Node-safe: ${message}`,
      {cause: error},
    );
  } finally {
    collectAndClearLoadedModules({
      namespaceQuery,
      initialCacheKeys,
      loadedPaths,
      cacheKeys,
      unregister: () => loader.unregister(),
    });
  }

  const features = module.features ?? module.default;
  if (!Array.isArray(features)) {
    throw new TypeError(
      `Features module "${resolvedFeaturesModule}" must export a features array.`,
    );
  }

  return {
    features: features as readonly ClientFeature[],
    loadedFiles: await localFiles(loadedPaths),
  };
}

function collectAndClearLoadedModules({
  namespaceQuery,
  initialCacheKeys,
  loadedPaths,
  cacheKeys,
  unregister,
}: {
  namespaceQuery: string;
  initialCacheKeys: ReadonlySet<string>;
  loadedPaths: Set<string>;
  cacheKeys: Set<string>;
  unregister: () => void;
}): void {
  const graph = loadedModuleGraph(namespaceQuery);
  for (const path of graph.loadedPaths) loadedPaths.add(path);
  for (const cacheKey of graph.cacheKeys) cacheKeys.add(cacheKey);
  const newCacheKeys = Object.keys(require.cache).filter(
    (cacheKey) => !initialCacheKeys.has(cacheKey),
  );
  recordLoadedModuleKeys(newCacheKeys, namespaceQuery, cacheKeys, loadedPaths);
  unregister();
  for (const cacheKey of cacheKeys) delete require.cache[cacheKey];
  for (const cacheKey of Object.keys(require.cache)) {
    if (cacheKey.endsWith(namespaceQuery)) delete require.cache[cacheKey];
  }
}
