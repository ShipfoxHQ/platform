import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {definitionValidationErrorSchema, definitionValidationWarningSchema} from '#schemas/dto.js';
import {triggerDtoSchema} from '#schemas/trigger.js';
import {workflowModelSnapshotSchema} from './workflow-model.js';

const idSchema = z.string().uuid();
const refSchema = z.string().min(1);
const configPathSchema = z.string().min(1);
const definitionSnapshotSchema = z.object({
  id: idSchema,
  workflowId: idSchema,
  projectId: idSchema,
  name: z.string(),
  model: workflowModelSnapshotSchema,
  sourceSnapshot: z.object({content: z.string(), format: z.literal('yaml')}).nullable(),
});
const refResolutionErrors = {
  'project-not-found': z.object({projectId: idSchema}),
  'ref-not-found': z.object({ref: refSchema}),
  'ref-invalid': z.object({ref: refSchema}),
  'ref-moved': z.object({ref: refSchema, expectedCommit: z.string()}),
  'file-not-found': z.object({ref: refSchema, configPath: configPathSchema}),
  'content-too-large': z.object({configPath: configPathSchema}),
  'invalid-definition': z.object({errors: z.array(definitionValidationErrorSchema)}),
  'source-unavailable': z.object({}),
};
const refListingErrors = {
  'project-not-found': z.object({projectId: idSchema}),
  'ref-not-found': z.object({ref: refSchema}),
  'ref-invalid': z.object({ref: refSchema}),
  'too-many-files': z.object({fileCount: z.number().int().positive()}),
  'source-unavailable': z.object({}),
};
const resolvedDefinitionAtRefSchema = z.object({
  workflow: z.object({id: idSchema, configPath: configPathSchema}),
  commit: z.string(),
  model: workflowModelSnapshotSchema,
  sourceSnapshot: z.object({content: z.string(), format: z.literal('yaml')}),
  triggers: z.record(z.string(), triggerDtoSchema),
  warnings: z.array(definitionValidationWarningSchema),
});
const definitionAtRefFileSchema = z.object({
  configPath: configPathSchema,
  name: z.string().nullable(),
  valid: z.boolean(),
  errors: z.array(definitionValidationErrorSchema),
  warnings: z.array(definitionValidationWarningSchema),
  triggers: z.record(z.string(), triggerDtoSchema),
});

export const definitionsInterModuleContract = defineInterModuleContract({
  module: 'definitions',
  methods: {
    getDefinitionForWorkflowRun: {
      input: z.object({definitionId: idSchema}),
      output: z.object({definition: definitionSnapshotSchema.nullable()}),
    },
    resolveDefinitionAtRef: {
      input: z.object({
        projectId: idSchema,
        ref: refSchema,
        configPath: configPathSchema,
        expectedCommit: z.string().optional(),
      }),
      output: resolvedDefinitionAtRefSchema,
      errors: refResolutionErrors,
    },
    listDefinitionsAtRef: {
      input: z.object({projectId: idSchema, ref: refSchema}),
      output: z.object({
        commit: z.string(),
        files: z.array(definitionAtRefFileSchema),
      }),
      errors: refListingErrors,
    },
  },
});

export type DefinitionsInterModuleClient = InterModuleClient<typeof definitionsInterModuleContract>;
export type DefinitionWorkflowSnapshot = z.infer<typeof definitionSnapshotSchema>;
