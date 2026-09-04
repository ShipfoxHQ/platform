import {globSync} from 'node:fs';
import {mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, extname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mapWithConcurrency, packProductionizedPackage, run} from '@shipfox/package-release/packer';
import {parse as parseYaml} from 'yaml';

import {
  computePublicationClosure,
  entryPointSupportsRuntimeImport,
  entryPointSupportsTypeResolution,
  listPublicPackageEntryPoints,
  readPublicationClosureConfig,
  readWorkspacePackages,
  renderFixtureWorkspaceConfig,
  validatePublicationState,
} from '../../dist/package-closure.js';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const REGISTRY_SHIPFOX_PACKAGE_PATTERN = /^@shipfox\+[^@]+@\d/u;
const config = readPublicationClosureConfig(resolve(repositoryRoot, 'publication-closure.json'));
const workspacePackages = readWorkspacePackages(repositoryRoot);
const dependencyContext = {
  workspaceConfig: parseYaml(await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')),
  workspaceVersions: new Map(
    [...workspacePackages]
      .filter(([, workspacePackage]) => typeof workspacePackage.manifest.version === 'string')
      .map(([name, workspacePackage]) => [name, workspacePackage.manifest.version]),
  ),
};
validatePublicationState(workspacePackages, config, repositoryRoot);
const closure = computePublicationClosure(
  workspacePackages,
  config.roots.filter((root) => !root.startsWith('@shipfox/client-')),
);
const fixtureRoot = await mkdtemp(join(tmpdir(), 'shipfox-api-runtime-'));
const tarballRoot = join(fixtureRoot, 'tarballs');
const stagingRoot = join(fixtureRoot, 'packages');

try {
  await Promise.all([mkdir(tarballRoot), mkdir(stagingRoot)]);
  const tarballs = await mapWithConcurrency(closure, 4, async (name) => {
    const workspacePackage = workspacePackages.get(name);
    if (!workspacePackage) throw new Error(`Missing workspace package: ${name}`);
    const tarball = join(tarballRoot, `${safePackageName(name)}.tgz`);
    await packProductionizedPackage({
      dependencyContext,
      manifest: workspacePackage.manifest,
      sourceDirectory: workspacePackage.directory,
      stagingRoot,
      packArtifact: (stagedDirectory) =>
        run('pnpm', ['pack', '--out', tarball], stagedDirectory, {stdio: 'ignore'}),
    });
    return [name, tarball];
  });

  const dependencies = Object.fromEntries(
    tarballs.map(([name, tarball]) => [name, `file:${tarball}`]),
  );
  const entryPoints = closure.flatMap((name) =>
    listPublicPackageEntryPoints(name, workspacePackages.get(name)?.manifest.exports),
  );
  const runtimeEntryPoints = entryPoints
    .filter(({target}) => entryPointSupportsRuntimeImport(target))
    .map(({specifier}) => specifier);
  const typeEntryPoints = entryPoints
    .filter(({target}) => entryPointSupportsTypeResolution(target))
    .map(({specifier}) => specifier);
  const publishedScenarios = listPublishedScenarios(closure, workspacePackages);
  const publishedEnvironment = await readPublishedTestEnvironment(closure, workspacePackages);
  const fixtureScenarios = await writeFixtureFiles(
    fixtureRoot,
    dependencies,
    runtimeEntryPoints,
    typeEntryPoints,
    publishedScenarios,
    publishedEnvironment,
  );
  await run('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], fixtureRoot);
  await validateInstalledPackages(fixtureRoot, closure, workspacePackages);
  await validateNoRegistryShipfoxPackages(fixtureRoot);

  const tsc = resolve(repositoryRoot, 'tools/typescript/node_modules/typescript/bin/tsc');
  await run(process.execPath, [tsc, '--project', 'tsconfig.json'], fixtureRoot);
  await run(process.execPath, ['runtime-imports.mjs'], fixtureRoot);
  for (const scenario of fixtureScenarios.filter(({extension}) => extension === '.mjs')) {
    const args = scenario.developmentCondition
      ? ['--conditions=development', scenario.fixtureName]
      : [scenario.fixtureName];
    await run(process.execPath, args, fixtureRoot);
  }
} finally {
  await rm(fixtureRoot, {recursive: true, force: true});
}

async function writeFixtureFiles(
  root,
  dependencies,
  runtimeEntryPoints,
  typeEntryPoints,
  publishedScenarios,
  environment,
) {
  const fixtureScenarios = publishedScenarios.map(({packageName, sourcePath}) => {
    const fixtureName = `${safePackageName(packageName)}-${basename(sourcePath)}`;
    return {
      developmentCondition: fixtureName.endsWith('.development.mjs'),
      extension: extname(fixtureName),
      fixtureName,
      sourcePath,
    };
  });
  await Promise.all([
    writeFile(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          name: 'shipfox-api-runtime-external-consumer',
          version: '1.0.0',
          private: true,
          type: 'module',
          dependencies,
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      join(root, 'pnpm-workspace.yaml'),
      renderFixtureWorkspaceConfig({repositoryRoot, overrides: dependencies}),
    ),
    writeFile(
      join(root, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: 'ES2024',
          },
          include: [
            'types.ts',
            ...fixtureScenarios
              .filter(({extension}) => extension === '.ts')
              .map(({fixtureName}) => fixtureName),
          ],
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      join(root, 'types.ts'),
      `${typeEntryPoints
        .map(
          (specifier, index) => `import type * as Entry${index} from ${JSON.stringify(specifier)};`,
        )
        .join(
          '\n',
        )}\n\n${typeEntryPoints.map((_, index) => `void (0 as unknown as typeof Entry${index});`).join('\n')}\n`,
    ),
    writeFile(
      join(root, 'runtime-imports.mjs'),
      `Object.assign(process.env, ${JSON.stringify(environment, null, 2)});\n\nconst entryPoints = ${JSON.stringify(runtimeEntryPoints, null, 2)};\nfor (const entryPoint of entryPoints) await import(entryPoint);\nconst {createServer, defaultModules} = await import('@shipfox/api-server');\nif (typeof createServer !== 'function' || typeof defaultModules !== 'function')\n  throw new Error('Packed API server does not export its composition API.');\nconst modules = [...(await defaultModules()), {name: 'external-dummy'}];\nif (modules.at(-1)?.name !== 'external-dummy')\n  throw new Error('Could not append an external module to the packed API server defaults.');\nconsole.log(\`Imported \${entryPoints.length} packed runtime entry points and composed API modules.\`);\nprocess.exit(0);\n`,
    ),
    ...fixtureScenarios.map(async ({extension, fixtureName, sourcePath}) => {
      const source = await readFile(sourcePath, 'utf8');
      const contents =
        extension === '.mjs'
          ? `Object.assign(process.env, ${JSON.stringify(environment, null, 2)});\n\n${source}`
          : source;
      await writeFile(join(root, fixtureName), contents);
    }),
  ]);
  return fixtureScenarios;
}

function listPublishedScenarios(names, workspacePackages) {
  return names.flatMap((packageName) => {
    const workspacePackage = workspacePackages.get(packageName);
    if (!workspacePackage) throw new Error(`Missing workspace package: ${packageName}`);
    return globSync(join(workspacePackage.directory, 'test/published/*.{mjs,ts}'))
      .filter((sourcePath) => !basename(sourcePath).startsWith('_'))
      .sort()
      .map((sourcePath) => ({packageName, sourcePath}));
  });
}

async function readPublishedTestEnvironment(names, workspacePackages) {
  const environmentPaths = names.flatMap((name) => {
    const workspacePackage = workspacePackages.get(name);
    if (!workspacePackage) throw new Error(`Missing workspace package: ${name}`);
    return globSync(join(workspacePackage.directory, 'test/published/_environment.mjs'));
  });
  if (environmentPaths.length !== 1) {
    throw new Error(
      `Packed API verification requires exactly one environment provider; found ${environmentPaths.length}`,
    );
  }
  const environmentModule = await import(pathToFileURL(environmentPaths[0]).href);
  const environment = environmentModule.publishedTestEnvironment?.();
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new Error('Packed API environment provider must return an environment object');
  }
  return environment;
}

async function validateInstalledPackages(root, names, workspacePackages) {
  const realFixtureRoot = await realpath(root);
  for (const name of names) {
    const installedManifestPath = join(root, 'node_modules', name, 'package.json');
    const installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8'));
    const expectedManifest = workspacePackages.get(name)?.manifest;
    if (!expectedManifest) throw new Error(`Missing workspace package: ${name}`);
    if (installedManifest.version !== expectedManifest.version) {
      throw new Error(
        `Packed ${name} has version ${installedManifest.version}; expected ${expectedManifest.version}`,
      );
    }
    if (installedManifest.private === true) throw new Error(`Packed ${name} is private`);
    const workspaceRange = findWorkspaceRange(installedManifest);
    if (workspaceRange) {
      throw new Error(`Packed ${name} contains a workspace range at ${workspaceRange}`);
    }
    const installedRoot = await realpath(join(root, 'node_modules', name));
    if (!installedRoot.startsWith(realFixtureRoot)) {
      throw new Error(`Packed ${name} resolved outside the external consumer`);
    }
  }
}

async function validateNoRegistryShipfoxPackages(root) {
  const virtualStore = await readdir(join(root, 'node_modules/.pnpm'), {withFileTypes: true});
  const registryPackages = virtualStore
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => REGISTRY_SHIPFOX_PACKAGE_PATTERN.test(name));
  if (registryPackages.length) {
    throw new Error(
      `External consumer used registry Shipfox packages: ${registryPackages.join(', ')}`,
    );
  }
}

function findWorkspaceRange(value, path = 'package.json') {
  if (typeof value === 'string') return value.startsWith('workspace:') ? path : undefined;
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value)) {
    const found = findWorkspaceRange(child, `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
}

function safePackageName(name) {
  return name.replace('@shipfox/', '').replaceAll('/', '-');
}
