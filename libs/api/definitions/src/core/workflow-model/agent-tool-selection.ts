import type {
  AgentToolSelectionCatalog,
  AgentToolSelector,
  IntegrationValidationContext,
  IntegrationWorkspaceConnection,
} from '../entities/integration-context.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssueCode,
} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

export interface AgentToolConnectionResolution {
  readonly connection: IntegrationWorkspaceConnection;
  readonly catalog: AgentToolSelectionCatalog;
  readonly selectorsByToken: ReadonlyMap<string, AgentToolSelector>;
}

/**
 * Resolves a connection slug to the provider's agent-tool selection catalog,
 * shared by the agent-integration and tool-step surfaces. Pushes the standard
 * missing-connection, unknown-connection, and not-capable issues and returns
 * `undefined` when the connection cannot serve tools.
 */
export function resolveAgentToolConnection(params: {
  connectionSlug: string | undefined;
  context: IntegrationValidationContext;
  /** Anchor for the connection-field issues (unknown connection, not capable). */
  connectionPath: readonly (string | number)[];
  /** Anchor for the missing-connection issue, which has no field to point at. */
  missingConnectionPath: readonly (string | number)[];
  missingConnectionCode: WorkflowModelValidationIssueCode;
  missingConnectionMessage: string;
  issueDetails?: Readonly<Record<string, unknown>>;
  issues: WorkflowModelValidationIssue[];
}): AgentToolConnectionResolution | undefined {
  const slug = params.connectionSlug;
  if (slug === undefined) {
    params.issues.push(
      issue({
        code: params.missingConnectionCode,
        message: params.missingConnectionMessage,
        path: params.missingConnectionPath,
        ...(params.issueDetails === undefined ? {} : {details: params.issueDetails}),
      }),
    );
    return undefined;
  }

  const connection = params.context.workspaceConnectionSnapshot.get(slug);
  if (connection === undefined) {
    params.issues.push(
      issue({
        code: 'integration-connection-not-found',
        message: `Integration connection "${slug}" was not found in the workspace.`,
        path: params.connectionPath,
        details: {connection: slug, ...params.issueDetails},
      }),
    );
    return undefined;
  }

  const catalog = params.context.agentToolSelectionCatalogs.get(connection.provider);
  if (catalog === undefined || !connection.capabilities.includes('agent_tools')) {
    params.issues.push(
      issue({
        code: 'integration-connection-not-capable',
        message: `Integration connection "${slug}" does not support agent tools.`,
        path: params.connectionPath,
        details: {
          connection: slug,
          provider: connection.provider,
          capabilities: connection.capabilities,
          ...params.issueDetails,
        },
      }),
    );
    return undefined;
  }

  return {
    connection,
    catalog,
    selectorsByToken: new Map(catalog.selectors.map((selector) => [selector.token, selector])),
  };
}

/** Distinguishes an unknown `family.method` token from an unknown tool id. */
export function classifyUnknownSelection(
  token: string,
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>,
): 'unknown-integration-method' | 'unknown-integration-tool' {
  const dotIndex = token.indexOf('.');
  if (dotIndex < 1) return 'unknown-integration-tool';

  const family = token.slice(0, dotIndex);
  return selectorsByToken.get(family)?.kind === 'family'
    ? 'unknown-integration-method'
    : 'unknown-integration-tool';
}
