import {normalizeWorkflowDocument} from '#core/workflow-model/index.js';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import type {DefinitionDb} from './definitions.js';
import {toDefinition} from './definitions.js';

describe('toDefinition', () => {
  it('maps legacy definition payloads without source snapshots to null', () => {
    const document = {
      name: 'Manual workflow',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [{run: 'pnpm build'}],
        },
      },
    };
    const row: DefinitionDb = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      workflowId: '019e98ab-6656-7ca1-b9ad-1ca4442c479e',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991381',
      configPath: '.shipfox/workflows/manual.yml',
      source: 'manual',
      sha: null,
      ref: null,
      name: 'Manual workflow',
      definition: {document, model: normalizeWorkflowDocument(document, {agentValidationCatalog})},
      contentHash: null,
      fetchedAt: new Date('2026-06-09T10:00:00.000Z'),
      createdAt: new Date('2026-06-09T10:00:01.000Z'),
      updatedAt: new Date('2026-06-09T10:00:02.000Z'),
      deletedAt: null,
    };

    const result = toDefinition(row);

    expect(result.sourceSnapshot).toBeNull();
  });
});
