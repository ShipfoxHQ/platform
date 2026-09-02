import {isSafeRefInput} from '@shipfox/regex';
import {z} from 'zod';
import {triggerDtoSchema} from './trigger.js';

/** Maximum UTF-8 encoded size of a workflow definition source file. */
export const MAX_WORKFLOW_FILE_BYTES = 1_000_000;

const utf8Encoder = new TextEncoder();

export const DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT = 100;
export const DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH = 128;
export const DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH = 2048;
export const DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH = 512;
export const DEFINITION_SYNC_DIAGNOSTIC_FILE_PATH_MAX_LENGTH = 512;
export const DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH = 2048;

export const createDefinitionBodySchema = z
  .object({
    project_id: z.string().uuid(),
    config_path: z.string().min(1).optional(),
    source: z.enum(['manual', 'vcs']).optional(),
    yaml: z
      .string()
      .min(1)
      .max(MAX_WORKFLOW_FILE_BYTES)
      .refine((value) => utf8Encoder.encode(value).length <= MAX_WORKFLOW_FILE_BYTES, {
        message: `yaml exceeds ${MAX_WORKFLOW_FILE_BYTES} bytes`,
      }),
    sha: z.string().optional(),
    ref: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const source = value.source ?? 'manual';
    if (source === 'vcs' && !value.config_path) {
      ctx.addIssue({
        code: 'custom',
        message: 'config_path is required for VCS definitions',
        path: ['config_path'],
      });
    }
    const hasRefOrSha = value.ref != null || value.sha != null;
    if (source === 'vcs' && !hasRefOrSha) {
      ctx.addIssue({
        code: 'custom',
        message: 'VCS definitions require a ref or sha',
        path: ['ref'],
      });
    }
    if (source === 'manual' && hasRefOrSha) {
      ctx.addIssue({
        code: 'custom',
        message: 'manual definitions must not set ref or sha',
        path: value.ref != null ? ['ref'] : ['sha'],
      });
    }
  });

export type CreateDefinitionBodyDto = z.infer<typeof createDefinitionBodySchema>;

export const definitionValidationErrorSchema = z.object({
  message: z.string(),
  path: z.string().optional(),
  reason: z.string().max(DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH).optional(),
});

export type DefinitionValidationErrorDto = z.infer<typeof definitionValidationErrorSchema>;

export const definitionValidationDiagnosticSchema = z.object({
  code: z.string().max(DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH),
  message: z.string().max(DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH),
  path: z.string().max(DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH).optional(),
  file_path: z.string().max(DEFINITION_SYNC_DIAGNOSTIC_FILE_PATH_MAX_LENGTH).optional(),
  severity: z.enum(['error', 'warning']),
});

export type DefinitionValidationDiagnosticDto = z.infer<
  typeof definitionValidationDiagnosticSchema
>;

export const definitionDtoSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  config_path: z.string().nullable(),
  source: z.enum(['manual', 'vcs']),
  sha: z.string().nullable(),
  ref: z.string().nullable(),
  name: z.string(),
  workflow_document: z.unknown(),
  workflow_model: z.unknown(),
  manual_trigger: z
    .object({
      name: z.string(),
    })
    .nullable(),
  fetched_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type DefinitionDto = z.infer<typeof definitionDtoSchema>;

export const definitionResponseSchema = definitionDtoSchema.extend({
  diagnostics: z
    .array(definitionValidationDiagnosticSchema)
    .max(DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT)
    .optional(),
});

export type DefinitionResponseDto = z.infer<typeof definitionResponseSchema>;

export const definitionListQuerySchema = z.object({
  project_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type DefinitionListQueryDto = z.infer<typeof definitionListQuerySchema>;

export const definitionSyncSummarySchema = z.object({
  ref: z.string().nullable(),
  status: z.enum(['pending', 'syncing', 'succeeded', 'failed']),
  last_sync_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  last_error_code: z
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
  last_error_message: z.string().max(DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH).nullable(),
  diagnostics: z
    .array(definitionValidationDiagnosticSchema)
    .max(DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT),
});

export type DefinitionSyncSummaryDto = z.infer<typeof definitionSyncSummarySchema>;

export const definitionListResponseSchema = z.object({
  definitions: z.array(definitionResponseSchema),
  sync: definitionSyncSummarySchema.nullable(),
  next_cursor: z.string().nullable(),
});

export type DefinitionListResponseDto = z.infer<typeof definitionListResponseSchema>;

export const definitionValidationWarningSchema = z.object({
  code: z.string().max(DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH),
  message: z.string().max(DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH),
  path: z.string().max(DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH).optional(),
});

export type DefinitionValidationWarningDto = z.infer<typeof definitionValidationWarningSchema>;

export const definitionAtRefQuerySchema = z.object({
  project_id: z.string().uuid(),
  ref: z.string().min(1).refine(isSafeRefInput, 'Ref contains a control character'),
});

export type DefinitionAtRefQueryDto = z.infer<typeof definitionAtRefQuerySchema>;

const definitionAtRefValidationErrorSchema = definitionValidationErrorSchema.extend({
  message: z.string().max(DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH),
  path: z.string().max(DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH).optional(),
});

export const definitionAtRefFileSchema = z.object({
  config_path: z.string().min(1),
  name: z.string().nullable(),
  valid: z.boolean(),
  errors: z.array(definitionAtRefValidationErrorSchema).max(DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT),
  warnings: z.array(definitionValidationWarningSchema).max(DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT),
  triggers: z.record(z.string(), triggerDtoSchema),
});

export type DefinitionAtRefFileDto = z.infer<typeof definitionAtRefFileSchema>;

export const definitionAtRefResponseSchema = z.object({
  ref: z.string(),
  commit: z.string(),
  files: z.array(definitionAtRefFileSchema),
});

export type DefinitionAtRefResponseDto = z.infer<typeof definitionAtRefResponseSchema>;
