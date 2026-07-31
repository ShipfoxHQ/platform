import {workspaceCreatedEventSchema} from './events.js';

describe('workspaceCreatedEventSchema', () => {
  test('accepts legacy events without a slug', () => {
    expect(
      workspaceCreatedEventSchema.parse({
        workspaceId: 'workspace-id',
        name: 'Workspace',
        creatorUserId: 'user-id',
      }),
    ).toEqual({
      workspaceId: 'workspace-id',
      name: 'Workspace',
      creatorUserId: 'user-id',
    });
  });
});
