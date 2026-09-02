import type {DefinitionSyncState} from '#core/entities/sync-state.js';
import type {WorkflowDefinition} from '#core/entities/workflow-definition.js';
import {normalizeWorkflowDocument} from '#core/workflow-model/index.js';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {toDefinitionDto, toDefinitionSyncSummaryDto} from './definition.js';

describe('toDefinitionDto', () => {
  it('maps the workflow definition entity to the public DTO shape', () => {
    const document = {
      name: 'Manual workflow',
      runner: 'ubuntu-latest',
      triggers: {
        run_now: {
          source: 'manual',
          event: 'fire',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'pnpm build'}],
        },
      },
    };
    const definition: WorkflowDefinition = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      workflowId: '019e98ab-6656-7ca1-b9ad-1ca4442c479e',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991381',
      configPath: '.shipfox/workflows/manual.yml',
      source: 'manual',
      sha: null,
      ref: null,
      name: document.name,
      definition: document,
      document,
      model: normalizeWorkflowDocument(document, {agentValidationCatalog}),
      sourceSnapshot: null,
      contentHash: null,
      fetchedAt: new Date('2026-06-09T10:00:00.000Z'),
      createdAt: new Date('2026-06-09T10:00:01.000Z'),
      updatedAt: new Date('2026-06-09T10:00:02.000Z'),
      deletedAt: null,
    };

    const result = toDefinitionDto(definition);

    expect(result).toEqual({
      id: definition.id,
      project_id: definition.projectId,
      config_path: definition.configPath,
      source: 'manual',
      sha: null,
      ref: null,
      name: document.name,
      workflow_document: document,
      workflow_model: definition.model,
      manual_trigger: {name: 'run_now'},
      fetched_at: '2026-06-09T10:00:00.000Z',
      created_at: '2026-06-09T10:00:01.000Z',
      updated_at: '2026-06-09T10:00:02.000Z',
    });
  });

  it('computes manual_trigger from the model so an inert manual trigger hides the Run button', () => {
    const document = {
      name: 'Manual workflow',
      runner: 'ubuntu-latest',
      triggers: {
        run_now: {
          source: 'manual',
          event: 'fire',
          filter: 'event.ref == "refs/heads/main"',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'pnpm build'}],
        },
      },
    };
    const definition: WorkflowDefinition = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      workflowId: '019e98ab-6656-7ca1-b9ad-1ca4442c479e',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991381',
      configPath: '.shipfox/workflows/manual.yml',
      source: 'manual',
      sha: null,
      ref: null,
      name: document.name,
      definition: document,
      document,
      // The manual trigger is inert: it carries a trigger-scoped error and is
      // excluded from the model, while the document keeps the authored entry.
      model: normalizeWorkflowDocument(document, {agentValidationCatalog}),
      sourceSnapshot: null,
      contentHash: null,
      fetchedAt: new Date('2026-06-09T10:00:00.000Z'),
      createdAt: new Date('2026-06-09T10:00:01.000Z'),
      updatedAt: new Date('2026-06-09T10:00:02.000Z'),
      deletedAt: null,
    };

    const result = toDefinitionDto(definition);

    expect(result.workflow_document).toEqual(document);
    expect((result.workflow_model as {triggers: readonly unknown[]}).triggers).toEqual([]);
    expect(result.manual_trigger).toBeNull();
  });

  it('hides the Run button when the manual trigger event is invalid', () => {
    const document = {
      name: 'Manual workflow',
      runner: 'ubuntu-latest',
      triggers: {
        run_now: {
          source: 'manual',
          event: 'run',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'pnpm build'}],
        },
      },
    };
    const definition: WorkflowDefinition = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      workflowId: '019e98ab-6656-7ca1-b9ad-1ca4442c479e',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991381',
      configPath: '.shipfox/workflows/manual.yml',
      source: 'manual',
      sha: null,
      ref: null,
      name: document.name,
      definition: document,
      document,
      model: normalizeWorkflowDocument(document, {agentValidationCatalog}),
      sourceSnapshot: null,
      contentHash: null,
      fetchedAt: new Date('2026-06-09T10:00:00.000Z'),
      createdAt: new Date('2026-06-09T10:00:01.000Z'),
      updatedAt: new Date('2026-06-09T10:00:02.000Z'),
      deletedAt: null,
    };

    const result = toDefinitionDto(definition);

    expect((result.workflow_model as {triggers: readonly unknown[]}).triggers).toEqual([]);
    expect(result.manual_trigger).toBeNull();
  });
});

describe('toDefinitionSyncSummaryDto', () => {
  it('maps the workflow file path to the public DTO field', () => {
    const syncState = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991381',
      sourceConnectionId: '019e98ab-b90f-7265-b13c-8b441c991382',
      sourceExternalRepositoryId: 'gitea:owner/platform',
      ref: 'main',
      status: 'failed',
      lastErrorCode: 'invalid-definition',
      lastErrorMessage: 'Invalid workflow definition',
      diagnostics: [
        {
          code: 'invalid-definition',
          message: 'Step gate success must be a valid CEL boolean expression.: No such key',
          path: 'jobs.build.steps.0.run',
          filePath: '.shipfox/workflows/ci.yml',
          severity: 'error',
        },
      ],
      startedAt: new Date('2026-06-09T10:00:00.000Z'),
      finishedAt: new Date('2026-06-09T10:00:01.000Z'),
      createdAt: new Date('2026-06-09T10:00:00.000Z'),
      updatedAt: new Date('2026-06-09T10:00:01.000Z'),
    } satisfies DefinitionSyncState;

    expect(toDefinitionSyncSummaryDto(syncState)).toMatchObject({
      status: 'failed',
      last_error_code: 'invalid-definition',
      last_error_message: 'Invalid workflow definition',
      diagnostics: [
        {
          code: 'invalid-definition',
          message: 'Step gate success must be a valid CEL boolean expression.: No such key',
          path: 'jobs.build.steps.0.run',
          file_path: '.shipfox/workflows/ci.yml',
          severity: 'error',
        },
      ],
    });
  });
});
