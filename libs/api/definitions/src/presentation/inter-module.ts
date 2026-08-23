import {createWorkflowModelSnapshot} from '@shipfox/api-definitions-dto';
import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {defineInterModulePresentation, type InterModulePresentation} from '@shipfox/inter-module';
import {getDefinitionById} from '#db/definitions.js';

export function createDefinitionsInterModulePresentation(): InterModulePresentation<
  typeof definitionsInterModuleContract
> {
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
  });
}
