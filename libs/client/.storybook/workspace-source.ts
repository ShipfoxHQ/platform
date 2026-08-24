import {createRequire} from 'node:module';

// The shared storybook config is loaded from a package whose own node_modules
// scope is not visible from this directory, so package-scoped modules resolve
// from the package that owns the running storybook instance (CWD), the same
// convention the shared main.ts uses for @tailwindcss/vite.
const require = createRequire(`${process.cwd()}/package.json`);
const {workspaceSourceResolver} = require('@shipfox/vite/workspace-source') as {
  workspaceSourceResolver: () => {name: string};
};
const {defaultClientConditions, defaultServerConditions} = require('vite') as {
  defaultClientConditions: readonly string[];
  defaultServerConditions: readonly string[];
};

export interface WorkspaceSourceConfig {
  plugins?: ReadonlyArray<{name?: string} | null | undefined>;
  resolve?: {conditions?: readonly string[]};
  ssr?: {resolve?: {conditions?: readonly string[]}};
}

function withCondition(conditions: readonly string[] | undefined, defaults: readonly string[]) {
  const resolvedConditions = [...(conditions ?? defaults)];

  if (!resolvedConditions.includes('workspace-source')) {
    resolvedConditions.push('workspace-source');
  }

  return resolvedConditions;
}

export function withWorkspaceSource(config: WorkspaceSourceConfig): WorkspaceSourceConfig {
  return {
    ...config,
    plugins: [...(config.plugins ?? []), workspaceSourceResolver()],
    resolve: {
      ...config.resolve,
      conditions: withCondition(config.resolve?.conditions, defaultClientConditions),
    },
    ssr: {
      ...config.ssr,
      resolve: {
        ...config.ssr?.resolve,
        conditions: withCondition(config.ssr?.resolve?.conditions, defaultServerConditions),
      },
    },
  };
}
