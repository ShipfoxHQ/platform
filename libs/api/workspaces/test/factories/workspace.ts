import {Factory} from 'fishery';
import type {Workspace} from '#core/entities/workspace.js';
import {createWorkspace} from '#db/workspaces.js';

export const workspaceFactory = Factory.define<Workspace>(({sequence, onCreate}) => {
  onCreate((workspace) => {
    return createWorkspace({name: workspace.name});
  });

  return {
    id: crypto.randomUUID(),
    name: `Test Workspace ${sequence}`,
    status: 'active',
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
