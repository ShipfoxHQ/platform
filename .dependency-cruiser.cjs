const path = require('node:path');

const workspaceRoot = __dirname;
const currentDirectory = process.cwd();
const currentPackage = require(path.join(currentDirectory, 'package.json'));
const {createApiArchitectureRules} = require('./api-contexts.cjs');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toPosixPath = (value) => value.split(path.sep).join('/');
const e2eRoot = path.join(workspaceRoot, 'e2e');
const currentE2ePath = toPosixPath(path.relative(e2eRoot, currentDirectory));
const currentE2eLayer =
  currentE2ePath === 'core'
    ? 'core'
    : currentE2ePath === 'kit'
      ? 'kit'
      : currentE2ePath.startsWith('screens/')
        ? 'screen'
        : currentE2ePath.startsWith('suites/')
          ? 'suite'
          : ['setup', 'observe', 'drivers'].some((prefix) => currentE2ePath.startsWith(`${prefix}/`))
            ? 'capability'
            : undefined;
const e2eSourcePath = '^(?:src|test|tests)(?:/|$)|^playwright\\.config\\.ts$';
const workspacePathPattern = (workspacePath) =>
  `^${escapeRegExp(toPosixPath(path.relative(currentDirectory, path.join(workspaceRoot, workspacePath))))}/`;
const currentApiArchitectureRules = createApiArchitectureRules({
  currentDirectory,
  workspaceRoot,
});
const isBelowWorkspacePath = (workspacePath) => {
  const relativePath = path.relative(path.join(workspaceRoot, workspacePath), currentDirectory);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
};
const e2eLayerPathPatterns = (workspacePath) =>
  isBelowWorkspacePath(workspacePath)
    ? [`^${escapeRegExp(toPosixPath(path.relative(currentDirectory, path.join(workspaceRoot, workspacePath))))}/[^.][^/]*/`]
    : [workspacePathPattern(workspacePath)];
const e2eSuitePathPatterns =
  currentE2eLayer === 'suite' ? ['^\\.\\./[^.][^/]*/', '^\\.\\./\\.\\./(?:api|client|flow)/'] : [workspacePathPattern('e2e/suites')];
const e2eLayerTargets = {
  core: {
    paths: ['e2e/core'],
    packages: ['^@shipfox/e2e-core(?:$|/)'],
  },
  capability: {
    paths: [...e2eLayerPathPatterns('e2e/setup'), ...e2eLayerPathPatterns('e2e/observe'), ...e2eLayerPathPatterns('e2e/drivers')],
    packages: ['^@shipfox/e2e-(?:setup|observe|driver)-'],
  },
  kit: {
    paths: ['e2e/kit'],
    packages: ['^@shipfox/e2e-kit(?:$|/)'],
  },
  screen: {
    paths: e2eLayerPathPatterns('e2e/screens'),
    packages: ['^@shipfox/e2e-screens-'],
  },
  suite: {
    paths: e2eSuitePathPatterns,
    packages: ['^@shipfox/e2e-(?:client|api|flow)-'],
  },
};
const e2eTargetPatterns = (layers) =>
  layers.flatMap((layer) => [
    ...e2eLayerTargets[layer].paths,
    ...e2eLayerTargets[layer].packages,
  ]);
const currentE2eLayerRule = ({name, comment, layers, disallowed}) => {
  if (!layers.includes(currentE2eLayer)) return [];

  return [
    {
      name,
      comment,
      severity: 'error',
      from: {path: e2eSourcePath},
      to: {
        path: e2eTargetPatterns(disallowed),
      },
    },
  ];
};
const currentE2eRules = currentE2eLayer
  ? [
      {
        name: 'e2e-no-server-api-packages',
        comment: 'E2E code must depend on API DTO packages, not server API packages.',
        severity: 'error',
        from: {path: e2eSourcePath},
        to: {
          path: [
            `${workspacePathPattern('libs/api')}(?!.*-dto(?:/|$))`,
            '^@shipfox/api-(?!.*-dto(?:$|/))',
          ],
        },
      },
      ...currentE2eLayerRule({
        name: 'e2e-core-is-bottom-layer',
        comment: '@shipfox/e2e-core must not depend on higher E2E layers.',
        layers: ['core'],
        disallowed: ['capability', 'kit', 'screen', 'suite'],
      }),
      ...currentE2eLayerRule({
        name: 'e2e-capabilities-only-depend-on-core',
        comment: 'E2E setup, observe, and driver packages must not depend on peer or higher E2E layers.',
        layers: ['capability'],
        disallowed: ['capability', 'kit', 'screen', 'suite'],
      }),
      ...currentE2eLayerRule({
        name: 'e2e-kit-does-not-depend-on-screens-or-suites',
        comment: '@shipfox/e2e-kit may provide shared authoring utilities but must not depend on screens or suites.',
        layers: ['kit'],
        disallowed: ['screen', 'suite'],
      }),
      ...currentE2eLayerRule({
        name: 'e2e-screens-are-leaf-packages',
        comment:
          'E2E screens may depend on the kit, core, and DTOs, but not suites, other screens, setup, observe, or drivers.',
        layers: ['screen'],
        disallowed: ['capability', 'screen', 'suite'],
      }),
      ...(currentE2eLayer === 'screen'
        ? [
            {
              name: 'e2e-screens-do-not-depend-on-client-runtime',
              comment: 'E2E screens are page-object contracts and must not depend on runtime client packages.',
              severity: 'error',
              from: {path: e2eSourcePath},
              to: {
                path: workspacePathPattern('libs/client'),
              },
            },
            {
              name: 'e2e-screens-no-playwright-runtime-import',
              comment: 'E2E screens may import Playwright for types only; value imports create a runtime dependency.',
              severity: 'error',
              from: {path: e2eSourcePath},
              to: {
                path: ['^@shipfox/playwright$', workspacePathPattern('tools/playwright')],
                dependencyTypesNot: ['type-only'],
              },
            },
          ]
        : []),
      ...currentE2eLayerRule({
        name: 'e2e-suites-do-not-import-suites',
        comment: 'E2E suites must not import other suites.',
        layers: ['suite'],
        disallowed: ['suite'],
      }),
    ]
  : [];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...(currentPackage.name.endsWith('-dto')
      ? [
          {
            name: 'dto-only-dto-as-dependencies',
            comment:
              '@shipfox/*-dto packages may only have other *-dto packages as production dependencies. All other @shipfox packages must be devDependencies.',
            severity: 'error',
            from: {path: '^(src|test)/'},
            to: {
              // pnpm workspace deps resolve as relative paths (../sibling/).
              // Match any workspace sibling that is not a *-dto package.
              path: '^\\.\\./[^./][^/]*/(?:src|dist)/',
              pathNot: '^\\.\\./[^/]+-dto/',
            },
          },
        ]
      : []),
    ...currentE2eRules,
    ...currentApiArchitectureRules,
    ...(currentPackage.name === '@shipfox/node-temporal'
      ? [
          {
            name: 'temporal-bundle-build-path-stays-config-free',
            comment:
              'Temporal bundle production runs during package builds and must not import runtime config, connection helpers, or the worker boundary.',
            severity: 'error',
            from: {path: '^src/(?:bundle\\.ts|bin/)'},
            to: {path: '^src/(?:config|connection-options|worker)\\.ts$'},
          },
        ]
      : []),
    ...(currentPackage.name === '@shipfox/api-triggers'
      ? [
          {
            name: 'triggers-use-workflows-inter-module-api',
            comment:
              'Triggers may consume the Workflows DTO contract, but never the Workflows implementation package.',
            severity: 'error',
            from: {path: '^(src|test)/'},
            to: {path: '^\\.\\./workflows/(?:src|dist)/'},
          },
        ]
      : []),
    ...(currentPackage.name === '@shipfox/api-workflows'
      ? [
          {
            name: 'workflows-use-annotations-inter-module-api',
            comment:
              'Workflows may consume the Annotations DTO contract, but never import the Annotations implementation package.',
            severity: 'error',
            from: {path: '^src/'},
            to: {path: '^\\.\\./annotations/(?:src|dist)/'},
          },
        ]
      : []),
    ...(['@shipfox/api-agent', '@shipfox/api-logs', '@shipfox/api-integration-core'].includes(
      currentPackage.name,
    )
      ? [
          {
            name: 'workflows-consumers-use-workflows-inter-module-api',
            comment:
              'Workflows consumers may use its DTO contract, but never import the Workflows implementation package.',
            severity: 'error',
            from: {path: '^(src|test)/'},
            to: {path: '^\\.\\./workflows/(?:src|dist)/'},
          },
        ]
      : []),
    ...(['@shipfox/api-definitions', '@shipfox/api-secrets', '@shipfox/api-workflows'].includes(
      currentPackage.name,
    )
      ? [
          {
            name: 'projects-consumers-use-projects-inter-module-api',
            comment:
              'Projects consumers may use its DTO contract, but never import the Projects implementation package.',
            severity: 'error',
            from: {path: '^(src|test)/'},
            to: {path: '^\\.\\./projects/(?:src|dist)/'},
          },
        ]
      : []),
    ...(['@shipfox/api-agent', '@shipfox/api-integration-jira', '@shipfox/api-integration-linear', '@shipfox/api-integration-slack', '@shipfox/api-workflows'].includes(currentPackage.name)
      ? [{name: 'secrets-consumers-use-inter-module-api', comment: 'Secrets consumers may depend on the Secrets DTO contract, but never the Secrets implementation package.', severity: 'error', from: {path: '^(src|test)/'}, to: {path: '(?:^|/)secrets/(?:src|dist)/'}}]
      : []),
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: 'specify',
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'workspace-source'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
