import {withSlugSuffix} from '@shipfox/api-common-dto';
import {Factory} from 'fishery';
import type {Workspace} from '#core/entities/workspace.js';
import {createWorkspace} from '#db/workspaces.js';

export const workspaceFactory = Factory.define<Workspace>(({sequence, onCreate}) => {
  onCreate((workspace) => {
    return createWorkspace({name: workspace.name, slug: workspace.slug});
  });

  return {
    id: crypto.randomUUID(),
    name: `Test Workspace ${sequence}`,
    slug: withSlugSuffix(`test-workspace-${crypto.randomUUID().slice(0, 8)}`, sequence + 1),
    status: 'active',
    settings: {},
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
