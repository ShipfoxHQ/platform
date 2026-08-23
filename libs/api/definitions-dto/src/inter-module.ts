import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {workflowModelSnapshotSchema} from './workflow-model.js';

const idSchema = z.string().uuid();
const definitionSnapshotSchema = z.object({
  id: idSchema,
  workflowId: idSchema,
  projectId: idSchema,
  name: z.string(),
  model: workflowModelSnapshotSchema,
  sourceSnapshot: z.object({content: z.string(), format: z.literal('yaml')}).nullable(),
});

export const definitionsInterModuleContract = defineInterModuleContract({
  module: 'definitions',
  methods: {
    getDefinitionForWorkflowRun: {
      input: z.object({definitionId: idSchema}),
      output: z.object({definition: definitionSnapshotSchema.nullable()}),
    },
  },
});

export type DefinitionsInterModuleClient = InterModuleClient<typeof definitionsInterModuleContract>;
export type DefinitionWorkflowSnapshot = z.infer<typeof definitionSnapshotSchema>;
