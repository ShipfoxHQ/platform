import {mkdtempSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {basename, dirname, isAbsolute, join} from 'node:path';
import type {ResourceLoader} from '@earendil-works/pi-coding-agent';
import {assertPiExtensionsLoaded, piExtensionDirectories} from '#core/pi-extensions.js';

const extensionPackageNames = ['pi-web-access', 'pi-mcp-adapter'] as const;
const require = createRequire(import.meta.url);

type PiExtensionsResult = ReturnType<ResourceLoader['getExtensions']>;

function extensionDirectory(packageName: string): string {
  const [directory] = piExtensionDirectories({packageNames: [packageName]});
  if (directory === undefined) throw new Error(`Missing resolved directory for ${packageName}`);
  return directory;
}

function resourceLoader(
  directories: readonly string[],
  errors: PiExtensionsResult['errors'] = [],
): Pick<ResourceLoader, 'getExtensions'> {
  return {
    getExtensions: (): PiExtensionsResult => ({
      extensions: directories.map((directory) => ({
        resolvedPath: join(directory, 'index.ts'),
      })) as PiExtensionsResult['extensions'],
      errors,
      runtime: undefined as never,
    }),
  };
}

describe('piExtensionDirectories', () => {
  it('resolves the real package directories with a non-empty Pi extension manifest', () => {
    const directories = piExtensionDirectories({packageNames: extensionPackageNames});

    expect(directories).toHaveLength(extensionPackageNames.length);
    for (const [index, directory] of directories.entries()) {
      const packageName = extensionPackageNames[index];
      if (packageName === undefined) throw new Error(`Missing package name at index ${index}`);
      const packageJson = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));

      expect(isAbsolute(directory)).toBe(true);
      expect(packageJson.name).toBe(packageName);
      expect(packageJson.pi?.extensions).toEqual(expect.arrayContaining([expect.any(String)]));
      expect(packageJson.pi.extensions.length).toBeGreaterThan(0);
    }
  });

  it('resolves pi-web-access through package.json because its bare package entry is absent', () => {
    expect(() => require.resolve('pi-web-access')).toThrow();

    const packageJsonPath = require.resolve('pi-web-access/package.json');
    const [directory] = piExtensionDirectories({packageNames: ['pi-web-access']});

    expect(dirname(packageJsonPath)).toBe(directory);
  });

  it('names the unavailable package when an injected resolver fails', () => {
    const packageName = 'pi-web-access';

    expect(() =>
      piExtensionDirectories({
        packageNames: [packageName],
        resolve: () => {
          throw new Error('resolver unavailable');
        },
      }),
    ).toThrow(`Unable to resolve Pi extension package "${packageName}": resolver unavailable`);
  });

  it('memoizes repeated real package resolution and returns the same directory string', () => {
    const [firstDirectory] = piExtensionDirectories({packageNames: ['pi-web-access']});
    const [secondDirectory] = piExtensionDirectories({packageNames: ['pi-web-access']});

    expect(secondDirectory).toBe(firstDirectory);
  });
});

describe('assertPiExtensionsLoaded', () => {
  it('accepts every requested directory when Pi reports an entry from each', () => {
    const directories = piExtensionDirectories({packageNames: extensionPackageNames});

    expect(() =>
      assertPiExtensionsLoaded({
        resourceLoader: resourceLoader(directories),
        directories,
      }),
    ).not.toThrow();
  });

  it('includes the missing directory and Pi error text when no extension loaded', () => {
    const resolvedDirectory = extensionDirectory('pi-web-access');
    const error = {
      path: resolvedDirectory,
      error: `Extension path does not exist: ${resolvedDirectory}`,
    };

    expect(() =>
      assertPiExtensionsLoaded({
        resourceLoader: resourceLoader([], [error]),
        directories: [resolvedDirectory],
      }),
    ).toThrow(`${resolvedDirectory}. Pi errors: ${JSON.stringify([error])}`);
  });

  it('accepts a symlinked extension directory like the pnpm development layout', () => {
    const resolvedDirectory = extensionDirectory('pi-web-access');
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'shipfox-pi-extension-'));
    const linkedDirectory = join(temporaryDirectory, 'pi-web-access');
    symlinkSync(resolvedDirectory, linkedDirectory, 'dir');

    try {
      expect(() =>
        assertPiExtensionsLoaded({
          resourceLoader: resourceLoader([linkedDirectory]),
          directories: [resolvedDirectory],
        }),
      ).not.toThrow();
    } finally {
      rmSync(temporaryDirectory, {recursive: true, force: true});
    }
  });

  it('does not treat a sibling directory with a similar name as a loaded extension', () => {
    const resolvedDirectory = extensionDirectory('pi-web-access');

    expect(() =>
      assertPiExtensionsLoaded({
        resourceLoader: resourceLoader([`${resolvedDirectory}-other`]),
        directories: [resolvedDirectory],
      }),
    ).toThrow(basename(resolvedDirectory));
  });
});
