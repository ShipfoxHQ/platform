import {workspaceSourceResolver} from '@shipfox/vite/workspace-source';
import type {InlineConfig} from 'vite';
import {defaultClientConditions, defaultServerConditions} from 'vite';

function withCondition(conditions: readonly string[] | undefined, defaults: readonly string[]) {
  const resolvedConditions = [...(conditions ?? defaults)];

  if (!resolvedConditions.includes('workspace-source')) {
    resolvedConditions.push('workspace-source');
  }

  return resolvedConditions;
}

export function withWorkspaceSource(config: InlineConfig): InlineConfig {
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
