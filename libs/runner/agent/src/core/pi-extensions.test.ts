import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {basename, dirname, isAbsolute, join} from 'node:path';
import type {ResourceLoader} from '@earendil-works/pi-coding-agent';
import {
  assertPiExtensionsLoaded,
  assertPiHarnessExtensionsAvailable,
  PI_HARNESS_EXTENSION_PACKAGE_NAMES,
  piExtensionDirectories,
  piExtensionDirectory,
} from '#core/pi-extensions.js';

const extensionPackageNames = ['pi-web-access', 'pi-mcp-adapter'] as const;
const require = createRequire(import.meta.url);

type PiExtensionsResult = ReturnType<ResourceLoader['getExtensions']>;

type PiExtensionFixture = {
  packageJson?: string;
  presentEntries?: readonly string[];
};

function extensionDirectory(packageName: string): string {
  return piExtensionDirectory({packageName});
}

/**
 * Builds a throwaway package tree standing in for a deployed production closure, so the entry
 * verification can be driven through layouts the pnpm development tree never produces.
 */
function piExtensionClosure(fixtures: Record<string, PiExtensionFixture>): {
  resolve: (specifier: string) => string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-pi-extension-'));

  for (const [packageName, fixture] of Object.entries(fixtures)) {
    const directory = join(root, packageName);
    mkdirSync(directory, {recursive: true});

    if (fixture.packageJson !== undefined)
      writeFileSync(join(directory, 'package.json'), fixture.packageJson);
    for (const entry of fixture.presentEntries ?? []) writeFileSync(join(directory, entry), '');
  }

  return {
    resolve: (specifier) => join(root, specifier),
    cleanup: () => rmSync(root, {recursive: true, force: true}),
  };
}

function completePiExtensionFixtures(): Record<string, PiExtensionFixture> {
  return Object.fromEntries(
    PI_HARNESS_EXTENSION_PACKAGE_NAMES.map((packageName) => [
      packageName,
      {
        packageJson: JSON.stringify({name: packageName, pi: {extensions: ['index.js']}}),
        presentEntries: ['index.js'],
      },
    ]),
  );
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

describe('assertPiHarnessExtensionsAvailable', () => {
  it('verifies every declared Pi extension entry exists in the installed packages', () => {
    expect(() => assertPiHarnessExtensionsAvailable()).not.toThrow();
  });

  it('accepts a closure where every declared entry is present', () => {
    const closure = piExtensionClosure(completePiExtensionFixtures());

    try {
      expect(() => assertPiHarnessExtensionsAvailable({resolve: closure.resolve})).not.toThrow();
    } finally {
      closure.cleanup();
    }
  });

  it('names the package and entry when a declared entry file is missing', () => {
    const closure = piExtensionClosure({
      ...completePiExtensionFixtures(),
      'pi-mcp-adapter': {
        packageJson: JSON.stringify({name: 'pi-mcp-adapter', pi: {extensions: ['index.js']}}),
      },
    });

    try {
      expect(() => assertPiHarnessExtensionsAvailable({resolve: closure.resolve})).toThrow(
        'Pi extension package "pi-mcp-adapter" is missing entry "index.js"',
      );
    } finally {
      closure.cleanup();
    }
  });

  it('checks every declared entry in a package manifest', () => {
    const closure = piExtensionClosure({
      ...completePiExtensionFixtures(),
      'pi-web-access': {
        packageJson: JSON.stringify({
          name: 'pi-web-access',
          pi: {extensions: ['present.js', 'missing.js']},
        }),
        presentEntries: ['present.js'],
      },
    });

    try {
      expect(() => assertPiHarnessExtensionsAvailable({resolve: closure.resolve})).toThrow(
        'Pi extension package "pi-web-access" is missing entry "missing.js"',
      );
    } finally {
      closure.cleanup();
    }
  });

  it('rejects a package that declares no Pi extension entries', () => {
    const closure = piExtensionClosure({
      ...completePiExtensionFixtures(),
      'pi-web-access': {packageJson: JSON.stringify({name: 'pi-web-access', pi: {extensions: []}})},
    });

    try {
      expect(() => assertPiHarnessExtensionsAvailable({resolve: closure.resolve})).toThrow(
        'Pi extension package "pi-web-access" has no pi.extensions entries.',
      );
    } finally {
      closure.cleanup();
    }
  });

  it('reports the package when its manifest cannot be read', () => {
    const closure = piExtensionClosure({
      ...completePiExtensionFixtures(),
      'pi-web-access': {packageJson: '{'},
    });

    try {
      expect(() => assertPiHarnessExtensionsAvailable({resolve: closure.resolve})).toThrow(
        'Unable to inspect Pi extension package "pi-web-access"',
      );
    } finally {
      closure.cleanup();
    }
  });
});
