import type {AgentValidationCatalogV2} from '@shipfox/api-agent-dto/inter-module';
import {DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH} from '@shipfox/api-definitions-dto';
import {InvalidWorkflowDocumentError} from '@shipfox/workflow-document';
import {definitionDefaultRunnerLabels} from '../config.js';
import type {IntegrationValidationContext} from './entities/integration-context.js';
import type {ValidationDiagnostic} from './entities/validation-diagnostic.js';
import type {WorkflowDefinitionPayload} from './entities/workflow-definition.js';
import {
  InvalidWorkflowModelError,
  normalizeWorkflowDocument,
  type WorkflowModelValidationIssue,
} from './workflow-model/index.js';
import {InvalidWorkflowYamlError, parseWorkflowYamlWithLocations} from './workflow-yaml/index.js';

export type ValidationError = {
  message: string;
  path?: string | undefined;
  reason?: string | undefined;
};
export type {ValidationDiagnostic} from './entities/validation-diagnostic.js';

export interface DefinitionValidationOptions {
  defaultRunnerLabels?: readonly string[];
  agentValidationCatalog: AgentValidationCatalogV2;
  integrationValidationContext?: IntegrationValidationContext;
}

export type ValidationResult =
  | {
      valid: true;
      definition: WorkflowDefinitionPayload;
      diagnostics: ValidationDiagnostic[];
      issues: WorkflowModelValidationIssue[];
    }
  | {valid: false; errors: ValidationError[]};

export function validateDefinition(
  yamlContent: string,
  options: DefinitionValidationOptions,
): ValidationResult {
  try {
    const {document, stepSourceLocations} = parseWorkflowYamlWithLocations(yamlContent);
    const diagnostics: WorkflowModelValidationIssue[] = [];
    const model = normalizeWorkflowDocument(document, {
      defaultRunnerLabels: options.defaultRunnerLabels ?? definitionDefaultRunnerLabels,
      agentValidationCatalog: options.agentValidationCatalog,
      integrationValidationContext: options.integrationValidationContext,
      stepSourceLocations,
      diagnostics,
    });
    return {
      valid: true,
      definition: {document, model},
      diagnostics: validationDiagnosticsFor(diagnostics),
      issues: diagnostics,
    };
  } catch (error) {
    return {valid: false, errors: validationErrorsFor(error)};
  }
}

function validationDiagnosticsFor(
  issues: readonly WorkflowModelValidationIssue[],
): ValidationDiagnostic[] {
  return issues.map((issue) =>
    validationDiagnostic({
      code: issue.code,
      message: issue.message,
      path: issue.path.join('.') || undefined,
      severity: issue.severity,
    }),
  );
}

function validationErrorsFor(error: unknown): ValidationError[] {
  if (error instanceof InvalidWorkflowYamlError) {
    return [
      validationError({
        message: error.message,
        path:
          error.location === undefined
            ? undefined
            : `${error.location.line}:${error.location.column}`,
      }),
    ];
  }

  if (error instanceof InvalidWorkflowDocumentError) {
    return error.validationError.issues.map((issue) =>
      validationError({
        message: issue.message,
        path: issue.path.join('.') || undefined,
      }),
    );
  }

  if (error instanceof InvalidWorkflowModelError) {
    return error.issues.map((issue) =>
      validationError({
        message: issue.message,
        path: issue.path.join('.'),
        reason:
          typeof issue.details?.reason === 'string'
            ? issue.details.reason.slice(0, DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH)
            : undefined,
      }),
    );
  }

  throw error;
}

function validationError(params: {
  message: string;
  path?: string | undefined;
  reason?: string | undefined;
}): ValidationError {
  return {
    message: params.message,
    ...(params.path === undefined ? {} : {path: params.path}),
    ...(params.reason === undefined ? {} : {reason: params.reason}),
  };
}

function validationDiagnostic(params: {
  code: string;
  message: string;
  path?: string | undefined;
  severity: 'error' | 'warning';
}): ValidationDiagnostic {
  if (params.path === undefined) {
    return {code: params.code, message: params.message, severity: params.severity};
  }
  return {code: params.code, message: params.message, path: params.path, severity: params.severity};
}
