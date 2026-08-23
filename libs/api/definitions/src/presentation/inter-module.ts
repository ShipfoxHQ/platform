import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {createWorkflowModelSnapshot} from '@shipfox/api-definitions-dto';
import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModuleMethodContract,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {DefinitionAtRefError, listDefinitionsAtRef, resolveDefinitionAtRef} from '#core/index.js';
import {getDefinitionById} from '#db/definitions.js';

export interface CreateDefinitionsInterModulePresentationParams {
  projects: ProjectsModuleClient;
  agent: AgentInterModuleClient;
  integrations: IntegrationsModuleClient;
}

export function createDefinitionsInterModulePresentation(
  params: CreateDefinitionsInterModulePresentationParams,
): InterModulePresentation<typeof definitionsInterModuleContract> {
  return defineInterModulePresentation(definitionsInterModuleContract, {
    getDefinitionForWorkflowRun: async ({definitionId}) => {
      const definition = await getDefinitionById(definitionId);
      if (!definition) return {definition: null};

      return {
        definition: {
          id: definition.id,
          workflowId: definition.workflowId,
          projectId: definition.projectId,
          name: definition.name,
          model: createWorkflowModelSnapshot(definition.model),
          sourceSnapshot: definition.sourceSnapshot,
        },
      };
    },
    resolveDefinitionAtRef: async (input) => {
      try {
        return await resolveDefinitionAtRef({...input, ...params});
      } catch (error) {
        throw toDefinitionAtRefKnownError(
          definitionsInterModuleContract.methods.resolveDefinitionAtRef,
          error,
        );
      }
    },
    listDefinitionsAtRef: async (input) => {
      try {
        return await listDefinitionsAtRef({...input, ...params});
      } catch (error) {
        throw toDefinitionAtRefKnownError(
          definitionsInterModuleContract.methods.listDefinitionsAtRef,
          error,
        );
      }
    },
  });
}

function toDefinitionAtRefKnownError(method: InterModuleMethodContract, error: unknown): unknown {
  if (!(error instanceof DefinitionAtRefError)) return error;
  const {code, details} = error;
  switch (code) {
    case 'project-not-found':
      return createInterModuleKnownError(method, 'project-not-found', {
        projectId: String(details.projectId),
      });
    case 'ref-not-found':
      return createInterModuleKnownError(method, 'ref-not-found', {ref: String(details.ref)});
    case 'ref-invalid':
      return createInterModuleKnownError(method, 'ref-invalid', {ref: String(details.ref)});
    case 'ref-moved':
      return createInterModuleKnownError(method, 'ref-moved', {
        ref: String(details.ref),
        expectedCommit: String(details.expectedCommit),
      });
    case 'file-not-found':
      return createInterModuleKnownError(method, 'file-not-found', {
        ref: String(details.ref),
        configPath: String(details.configPath),
      });
    case 'content-too-large':
      return createInterModuleKnownError(method, 'content-too-large', {
        configPath: String(details.configPath),
      });
    case 'invalid-definition':
      return createInterModuleKnownError(method, 'invalid-definition', {
        errors: details.errors as Array<{message: string; path?: string}>,
      });
    case 'source-unavailable':
      return createInterModuleKnownError(method, 'source-unavailable', {});
  }
}
