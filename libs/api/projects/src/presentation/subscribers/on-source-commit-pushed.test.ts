import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {
  INTEGRATION_SOURCE_COMMIT_PUSHED,
  type IntegrationSourceCommitPushedEvent,
  type SourcePushPayload,
} from '@shipfox/api-integration-core-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {PROJECT_SOURCE_COMMIT_OBSERVED} from '@shipfox/api-projects-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {and, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projectFactory} from '#test/index.js';
import {createProjectsModule} from '../../index.js';
import {onSourceCommitPushed} from './on-source-commit-pushed.js';

function buildPush(overrides: Partial<SourcePushPayload> = {}): SourcePushPayload {
  return {
    externalRepositoryId: 'github:42',
    ref: 'main',
    headCommitSha: 'abc123',
    defaultBranch: 'main',
    isDefaultBranch: true,
    ...overrides,
  };
}

function buildEvent(
  overrides: Partial<IntegrationSourceCommitPushedEvent> = {},
  pushOverrides: Partial<SourcePushPayload> = {},
  id = crypto.randomUUID(),
): DomainEvent<IntegrationSourceCommitPushedEvent> {
  return {
    id,
    type: INTEGRATION_SOURCE_COMMIT_PUSHED,
    createdAt: new Date(),
    payload: {
      provider: 'github',
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      deliveryId: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      push: buildPush(pushOverrides),
      ...overrides,
    },
  };
}

async function listCommitObservedEvents(externalRepositoryId: string) {
  return await db()
    .select()
    .from(projectsOutbox)
    .where(
      and(
        eq(projectsOutbox.eventType, PROJECT_SOURCE_COMMIT_OBSERVED),
        sql`${projectsOutbox.payload}->>'externalRepositoryId' = ${externalRepositoryId}`,
      ),
    );
}

describe('onSourceCommitPushed', () => {
  it('publishes a project source commit event for a default-branch push', async () => {
    const sourceConnectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    const project = await projectFactory.create({
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    const event = buildEvent(
      {workspaceId, connectionId: sourceConnectionId},
      {externalRepositoryId},
    );

    await onSourceCommitPushed(event.payload, event);

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({
      workspaceId,
      projectId: project.id,
      sourceConnectionId,
      provider: 'github',
      externalRepositoryId,
      ref: 'main',
      headCommitSha: 'abc123',
    });
  });

  it('does not publish for a non-default branch push', async () => {
    const sourceConnectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    await projectFactory.create({
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    const event = buildEvent(
      {workspaceId, connectionId: sourceConnectionId},
      {externalRepositoryId, ref: 'feature/x', isDefaultBranch: false},
    );

    await onSourceCommitPushed(event.payload, event);

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(0);
  });

  it('does not publish when no project is bound to the pushed repository', async () => {
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    const event = buildEvent({}, {externalRepositoryId});

    await onSourceCommitPushed(event.payload, event);

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(0);
  });

  it('deduplicates the same source event for the same project', async () => {
    const sourceConnectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    await projectFactory.create({
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    const event = buildEvent(
      {workspaceId, connectionId: sourceConnectionId},
      {externalRepositoryId},
    );

    await onSourceCommitPushed(event.payload, event);
    await onSourceCommitPushed(event.payload, event);

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(1);
  });

  // The source/event filter is the subscription itself, so this module should
  // only receive the typed source-control event.
  it('registers the projects module on INTEGRATION_SOURCE_COMMIT_PUSHED', () => {
    const module = createProjectsModule({
      integrations: {} as IntegrationsModuleClient,
      auth: {} as AuthInterModuleClient,
    });

    const events = module.subscribers?.map((subscriber) => subscriber.event);

    expect(events).toContain(INTEGRATION_SOURCE_COMMIT_PUSHED);
  });
});
