import type {AgentValidationCatalog} from '@shipfox/api-agent-dto/inter-module';
import {InvalidWorkflowDocumentError} from '@shipfox/workflow-document';
import {definitionDefaultRunnerLabels} from '../config.js';
import type {IntegrationValidationContext} from './entities/integration-context.js';
import type {ValidationWarning} from './entities/validation-warning.js';
import type {WorkflowDefinitionPayload} from './entities/workflow-definition.js';
import {
  InvalidWorkflowModelError,
  normalizeWorkflowDocument,
  type WorkflowModelValidationIssue,
} from './workflow-model/index.js';
import {InvalidWorkflowYamlError, parseWorkflowYamlWithLocations} from './workflow-yaml/index.js';

export type ValidationError = {message: string; path?: string | undefined};
export type {ValidationWarning} from './entities/validation-warning.js';

export interface DefinitionValidationOptions {
  defaultRunnerLabels?: readonly string[];
  agentValidationCatalog: AgentValidationCatalog;
  integrationValidationContext?: IntegrationValidationContext;
}

export type ValidationResult =
  | {valid: true; definition: WorkflowDefinitionPayload; warnings: ValidationWarning[]}
  | {valid: false; errors: ValidationError[]};

export function validateDefinition(
  yamlContent: string,
  options: DefinitionValidationOptions,
): ValidationResult {
  try {
    const {document, stepSourceLocations} = parseWorkflowYamlWithLocations(yamlContent);
    const warnings: WorkflowModelValidationIssue[] = [];
    const model = normalizeWorkflowDocument(document, {
      defaultRunnerLabels: options.defaultRunnerLabels ?? definitionDefaultRunnerLabels,
      agentValidationCatalog: options.agentValidationCatalog,
      integrationValidationContext: options.integrationValidationContext,
      stepSourceLocations,
      warnings,
    });
    return {valid: true, definition: {document, model}, warnings: validationWarningsFor(warnings)};
  } catch (error) {
    return {valid: false, errors: validationErrorsFor(error)};
  }
}

function validationWarningsFor(
  issues: readonly WorkflowModelValidationIssue[],
): ValidationWarning[] {
  return issues.map((issue) =>
    validationWarning({
      code: issue.code,
      message: issue.message,
      path: issue.path.join('.') || undefined,
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
      validationError({message: issue.message, path: issue.path.join('.')}),
    );
  }

  throw error;
}

function validationError(params: {message: string; path?: string | undefined}): ValidationError {
  if (params.path === undefined) return {message: params.message};
  return {message: params.message, path: params.path};
}

function validationWarning(params: {
  code: string;
  message: string;
  path?: string | undefined;
}): ValidationWarning {
  if (params.path === undefined) return {code: params.code, message: params.message};
  return {code: params.code, message: params.message, path: params.path};
}
