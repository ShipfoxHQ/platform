import {projectCreatedEventSchema} from './events.js';

const legacyProjectCreatedEvent = {
  actorId: 'actor-1',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  sourceConnectionId: 'connection-1',
  sourceExternalRepositoryId: 'repository-1',
};

describe('project created event schema', () => {
  test('accepts legacy in-flight payloads without a slug', () => {
    expect(projectCreatedEventSchema.parse(legacyProjectCreatedEvent)).toEqual(
      legacyProjectCreatedEvent,
    );
  });

  test('preserves slugs on new payloads', () => {
    expect(
      projectCreatedEventSchema.parse({...legacyProjectCreatedEvent, slug: 'project'}),
    ).toMatchObject({slug: 'project'});
  });
});
