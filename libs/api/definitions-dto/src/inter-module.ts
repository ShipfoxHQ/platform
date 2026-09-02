import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
  DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH,
  definitionValidationErrorSchema,
  definitionValidationWarningSchema,
} from '#schemas/dto.js';
import {triggerDtoSchema} from '#schemas/trigger.js';
import {workflowModelSnapshotSchema} from './workflow-model.js';

const idSchema = z.string().uuid();
const refSchema = z.string().min(1);
const configPathSchema = z.string().min(1);
const definitionListCursorSchema = z.object({value: z.string(), id: idSchema});
const definitionSyncDiagnosticSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
  filePath: z.string().optional(),
  severity: z.enum(['error', 'warning']),
});
const definitionSyncSummarySchema = z.object({
  ref: z.string().nullable(),
  status: z.enum(['pending', 'syncing', 'succeeded', 'failed']),
  lastSyncAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  lastErrorCode: z
    .enum([
      'no-workflow-files',
      'invalid-definition',
      'provider-repository-not-found',
      'provider-file-not-found',
      'provider-access-denied',
      'provider-rate-limited',
      'provider-timeout',
      'provider-unavailable',
      'provider-malformed-response',
      'content-too-large',
      'too-many-files',
      'connection-unavailable',
      'unknown',
    ])
    .nullable(),
  lastErrorMessage: z.string().max(DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH).nullable(),
  diagnostics: z.array(definitionSyncDiagnosticSchema),
});
const definitionListItemSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  configPath: z.string().nullable(),
  source: z.enum(['manual', 'vcs']),
  sha: z.string().nullable(),
  ref: z.string().nullable(),
  name: z.string(),
  workflowDocument: z.unknown(),
  workflowModel: z.unknown(),
  manualTrigger: z.object({name: z.string()}).nullable(),
  fetchedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
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
    listDefinitionsByProject: {
      input: z.object({
        workspaceId: idSchema,
        projectId: idSchema,
        limit: z.number().int().min(1).max(100),
        cursor: definitionListCursorSchema.optional(),
      }),
      output: z.object({
        definitions: z.array(definitionListItemSchema),
        sync: definitionSyncSummarySchema.nullable(),
        nextCursor: definitionListCursorSchema.nullable(),
      }),
      errors: {
        'project-not-found': z.object({projectId: idSchema}),
        'project-workspace-mismatch': z.object({projectId: idSchema, workspaceId: idSchema}),
      },
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
export type DefinitionListItem = z.infer<typeof definitionListItemSchema>;
export type DefinitionSyncSummary = z.infer<typeof definitionSyncSummarySchema>;
