import type {WorkflowDefinition} from '#core/entities/workflow-definition.js';
import {normalizeWorkflowDocument} from '#core/workflow-model/index.js';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {toDefinitionDto} from './definition.js';

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
});
