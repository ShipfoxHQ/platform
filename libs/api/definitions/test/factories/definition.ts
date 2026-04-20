import {Factory} from 'fishery';
import type {WorkflowDefinition, WorkflowSpec} from '#core/entities/definition.js';
import {upsertDefinition} from '#db/definitions.js';

function defaultSpec(): WorkflowSpec {
  return {
    name: 'Test Workflow',
    jobs: {
      build: {
        steps: [{run: 'echo hello'}],
      },
    },
  };
}

export const definitionFactory = Factory.define<WorkflowDefinition>(({sequence, onCreate}) => {
  const projectId = crypto.randomUUID();

  onCreate((definition) => {
    return upsertDefinition({
      projectId: definition.projectId,
      configPath: definition.configPath,
      source: definition.source,
      name: definition.name,
      definition: definition.definition,
      sha: definition.sha ?? undefined,
      ref: definition.ref ?? undefined,
    });
  });

  return {
    id: crypto.randomUUID(),
    projectId,
    configPath: `.shipfox/workflows/test-${sequence}.yml`,
    source: 'manual',
    sha: null,
    ref: null,
    name: `Test Workflow ${sequence}`,
    definition: defaultSpec(),
    fetchedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
