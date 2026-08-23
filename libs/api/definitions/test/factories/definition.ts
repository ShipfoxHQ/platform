import {Factory} from 'fishery';
import type {
  WorkflowDefinition,
  WorkflowDefinitionPayload,
} from '#core/entities/workflow-definition.js';
import {normalizeWorkflowDocument} from '#core/workflow-model/index.js';
import {upsertDefinition} from '#db/definitions.js';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';

function defaultDefinition(): WorkflowDefinitionPayload {
  const document = {
    name: 'Test Workflow',
    runner: 'ubuntu-latest',
    jobs: {
      build: {
        steps: [{run: 'echo hello'}],
      },
    },
  };
  return {document, model: normalizeWorkflowDocument(document, {agentValidationCatalog})};
}

interface DefinitionTransients {
  workspaceId: string;
}

export const definitionFactory = Factory.define<WorkflowDefinition, DefinitionTransients>(
  ({sequence, onCreate, transientParams}) => {
    const projectId = crypto.randomUUID();

    onCreate((definition) => {
      return upsertDefinition({
        projectId: definition.projectId,
        workspaceId: transientParams.workspaceId ?? crypto.randomUUID(),
        configPath: definition.configPath,
        source: definition.source,
        name: definition.name,
        document: definition.document,
        model: definition.model,
        sourceSnapshot: definition.sourceSnapshot,
        contentHash: definition.contentHash ?? undefined,
        sha: definition.sha ?? undefined,
        ref: definition.ref ?? undefined,
      });
    });

    const definition = defaultDefinition();

    return {
      id: crypto.randomUUID(),
      workflowId: crypto.randomUUID(),
      projectId,
      configPath: `.shipfox/workflows/test-${sequence}.yml`,
      source: 'manual',
      sha: null,
      ref: null,
      name: `Test Workflow ${sequence}`,
      definition: definition.document,
      ...definition,
      sourceSnapshot: definition.sourceSnapshot ?? null,
      contentHash: null,
      fetchedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
  },
);
