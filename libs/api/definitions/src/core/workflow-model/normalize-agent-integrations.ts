import type {WorkflowDocumentStepIntegration} from '@shipfox/workflow-document';
import type {
  AgentToolSelector,
  IntegrationValidationContext,
} from '../entities/integration-context.js';
import type {WorkflowModelStepIntegration} from '../entities/workflow-model.js';
import {classifyUnknownSelection, resolveAgentToolConnection} from './agent-tool-selection.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

export function normalizeAgentIntegrations(params: {
  integrations: readonly WorkflowDocumentStepIntegration[] | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  integrationValidationContext?: IntegrationValidationContext | undefined;
}): readonly WorkflowModelStepIntegration[] | undefined {
  if (params.integrations === undefined) return undefined;

  return params.integrations.map((integration, integrationIndex) => {
    const normalized = normalizeIntegration(integration);
    validateIntegration({...params, integration, normalized, integrationIndex});
    return normalized;
  });
}

function normalizeIntegration(
  integration: WorkflowDocumentStepIntegration,
): WorkflowModelStepIntegration {
  return {
    ...(integration.connection === undefined ? {} : {connection: integration.connection}),
    include: dedupe(integration.include),
    ...(integration.exclude === undefined ? {} : {exclude: dedupe(integration.exclude)}),
    allowWrite: integration.allow_write ?? false,
  };
}

function validateIntegration(params: {
  integration: WorkflowDocumentStepIntegration;
  normalized: WorkflowModelStepIntegration;
  sourceName: string;
  stepIndex: number;
  integrationIndex: number;
  issues: WorkflowModelValidationIssue[];
  integrationValidationContext?: IntegrationValidationContext | undefined;
}): void {
  const context = params.integrationValidationContext;
  if (context === undefined) return;

  const integrationPath = [
    'jobs',
    params.sourceName,
    'steps',
    params.stepIndex,
    'integrations',
    params.integrationIndex,
  ] as const;
  const issueDetails = {integrationIndex: params.integrationIndex};
  const resolved = resolveAgentToolConnection({
    connectionSlug: params.normalized.connection ?? context.defaultConnectionSlug,
    context,
    connectionPath:
      params.normalized.connection === undefined
        ? integrationPath
        : [...integrationPath, 'connection'],
    missingConnectionPath: integrationPath,
    missingConnectionCode: 'missing-connection-for-integration',
    missingConnectionMessage:
      'Agent step integration requires a connection or a default source connection.',
    issueDetails,
    issues: params.issues,
  });
  if (resolved === undefined) return;

  validateSelection({
    ...params,
    field: 'include',
    tokens: params.integration.include,
    selectorsByToken: resolved.selectorsByToken,
    integrationPath,
  });
  if (params.integration.exclude !== undefined) {
    validateSelection({
      ...params,
      field: 'exclude',
      tokens: params.integration.exclude,
      selectorsByToken: resolved.selectorsByToken,
      integrationPath,
    });
  }
  validateWriteSelection({...params, selectorsByToken: resolved.selectorsByToken});
}

function validateSelection(params: {
  field: 'include' | 'exclude';
  tokens: readonly string[];
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>;
  sourceName: string;
  stepIndex: number;
  integrationIndex: number;
  issues: WorkflowModelValidationIssue[];
  integrationPath: readonly (string | number)[];
}): void {
  params.tokens.forEach((token, tokenIndex) => {
    if (params.selectorsByToken.has(token)) return;

    const code = classifyUnknownSelection(token, params.selectorsByToken);
    params.issues.push(
      issue({
        code,
        message:
          code === 'unknown-integration-method'
            ? `Unknown integration tool method: ${token}.`
            : `Unknown integration tool: ${token}.`,
        path: [...params.integrationPath, params.field, tokenIndex],
        details: {token},
      }),
    );
  });
}

function validateWriteSelection(params: {
  integration: WorkflowDocumentStepIntegration;
  normalized: WorkflowModelStepIntegration;
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>;
  sourceName: string;
  stepIndex: number;
  integrationIndex: number;
  issues: WorkflowModelValidationIssue[];
}): void {
  if (params.normalized.allowWrite) return;

  const writeTokens = dedupe(
    params.integration.include.filter(
      (token) => params.selectorsByToken.get(token)?.sensitivity === 'write',
    ),
  );
  if (writeTokens.length === 0) return;

  params.issues.push(
    issue({
      code: 'integration-write-not-allowed',
      message: `Integration selection includes write-capable tools but allow_write is not true: ${writeTokens.join(', ')}.`,
      path: [
        'jobs',
        params.sourceName,
        'steps',
        params.stepIndex,
        'integrations',
        params.integrationIndex,
        'include',
      ],
      details: {tokens: writeTokens},
    }),
  );
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
