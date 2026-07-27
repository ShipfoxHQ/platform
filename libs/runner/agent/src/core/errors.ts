import type {
  AgentSessionRuntimeDiagnostic,
  LoadExtensionsResult,
} from '@earendil-works/pi-coding-agent';
import type {AgentConfigIssueDto} from '@shipfox/api-workflows-dto';

/**
 * A user-fixable agent-step configuration failure: an unknown provider, a
 * provider/model pair pi does not know, or workspace provider credentials that
 * are missing or incomplete. The step layer translates this to the
 * `agent_config_invalid` reason, distinct from a genuine provider/API failure
 * (`agent_invocation_failed`).
 */
export class AgentConfigError extends Error {
  constructor(
    message: string,
    public readonly agentConfigIssue: AgentConfigIssueDto,
  ) {
    super(message);
    this.name = 'AgentConfigError';
  }
}

export interface AgentHarnessEnvironment {
  readonly cwd: string;
  readonly provider: string;
  readonly model: string;
  readonly thinking: string;
  readonly extensionPaths: readonly string[];
  readonly resolvedExtensionPaths?: readonly string[];
}

export class AgentHarnessUnavailableError extends Error {
  public readonly diagnostics: readonly AgentSessionRuntimeDiagnostic[];
  public readonly environment: AgentHarnessEnvironment;
  public readonly resourceLoaderErrors: readonly LoadExtensionsResult['errors'][number][];

  constructor({
    diagnostics,
    environment,
    resourceLoaderErrors = [],
  }: {
    diagnostics: readonly AgentSessionRuntimeDiagnostic[];
    environment: AgentHarnessEnvironment;
    resourceLoaderErrors?: readonly LoadExtensionsResult['errors'][number][];
  }) {
    const errors = diagnostics.filter((diagnostic) => diagnostic.type === 'error');
    const messages = [
      ...errors.map((diagnostic) => diagnostic.message),
      ...resourceLoaderErrors.map((resourceError) => resourceError.error),
    ];
    super(`Pi extension setup failed: ${messages.join('; ')}`);
    this.name = 'AgentHarnessUnavailableError';
    this.diagnostics = diagnostics;
    this.environment = environment;
    this.resourceLoaderErrors = resourceLoaderErrors;
  }
}

export class AgentInvocationError extends Error {
  constructor(
    message: string,
    public readonly response: string | undefined,
  ) {
    super(message);
    this.name = 'AgentInvocationError';
  }
}

export class AgentPermissionModeError extends Error {
  constructor(
    public readonly requested: string,
    public readonly observed: string,
  ) {
    super(
      `Claude agent permission mode was downgraded: requested "${requested}", observed "${observed}".`,
    );
    this.name = 'AgentPermissionModeError';
  }
}
