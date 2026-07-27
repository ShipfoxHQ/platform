import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const packageVersionCache = new Map<string, string | undefined>();

export interface PiPackageVersions {
  readonly pi?: string;
  readonly piMcpAdapter?: string;
  readonly piWebAccess?: string;
}

/**
 * Reads the versions of the packages that make up the Pi harness. Each lookup is best effort:
 * diagnostics must still be emitted when a broken installation cannot resolve its own metadata.
 */
export function piPackageVersions(): PiPackageVersions {
  const pi = packageVersion('@earendil-works/pi-coding-agent');
  const piMcpAdapter = packageVersion('pi-mcp-adapter');
  const piWebAccess = packageVersion('pi-web-access');

  return {
    ...(pi === undefined ? {} : {pi}),
    ...(piMcpAdapter === undefined ? {} : {piMcpAdapter}),
    ...(piWebAccess === undefined ? {} : {piWebAccess}),
  };
}

function packageVersion(packageName: string): string | undefined {
  if (packageVersionCache.has(packageName)) return packageVersionCache.get(packageName);

  let version: string | undefined;
  try {
    const packageJsonPath = resolvePackageJson(packageName);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: unknown;
    };
    version = typeof packageJson.version === 'string' ? packageJson.version : undefined;
  } catch {
    version = undefined;
  }

  packageVersionCache.set(packageName, version);
  return version;
}

function resolvePackageJson(packageName: string): string {
  try {
    return require.resolve(`${packageName}/package.json`);
  } catch {
    // Pi exposes its ESM entry but intentionally does not export package.json. Resolve the
    // entry and walk back to the package root without assuming the deployed /app path.
    const entry = fileURLToPath(import.meta.resolve(packageName));
    return join(dirname(entry), '..', 'package.json');
  }
}
