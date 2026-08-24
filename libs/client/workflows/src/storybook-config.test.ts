import {describe, expect, it} from '@shipfox/vitest/vi';
import {withWorkspaceSource} from '../../.storybook/workspace-source';

describe('client-workflows Storybook Vite configuration', () => {
  it('keeps workspace-source active for client and SSR package resolution', () => {
    const config = withWorkspaceSource({
      resolve: {conditions: ['browser']},
      ssr: {resolve: {conditions: ['node']}},
    });

    expect(config.resolve?.conditions).toEqual(['browser', 'workspace-source']);
    expect(config.ssr?.resolve?.conditions).toEqual(['node', 'workspace-source']);
    expect(config.plugins?.map((plugin) => plugin && 'name' in plugin && plugin.name)).toContain(
      'shipfox:workspace-source-resolver',
    );
  });

  it('does not duplicate an existing workspace-source condition', () => {
    const config = withWorkspaceSource({
      resolve: {conditions: ['browser', 'workspace-source']},
      ssr: {resolve: {conditions: ['node', 'workspace-source']}},
    });

    expect(config.resolve?.conditions).toEqual(['browser', 'workspace-source']);
    expect(config.ssr?.resolve?.conditions).toEqual(['node', 'workspace-source']);
  });
});
