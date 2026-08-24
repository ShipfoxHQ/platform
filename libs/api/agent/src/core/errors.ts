import type {
  AgentThinking,
  Harness,
  ModelProviderRef,
  SupportedModelProviderId,
} from '@shipfox/api-agent-dto';

export class ModelProviderValidationError extends Error {
  constructor(
    public readonly providerId: ModelProviderRef,
    public readonly sanitizedMessage: string,
  ) {
    super(`Model provider validation failed for ${providerId}: ${sanitizedMessage}`);
    this.name = 'ModelProviderValidationError';
  }
}

export class ModelProviderConfigNotFoundError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly providerId: string,
  ) {
    super(`Model provider config not found: ${workspaceId}/${providerId}`);
    this.name = 'ModelProviderConfigNotFoundError';
  }
}

export class UnsupportedModelProviderError extends Error {
  constructor(public readonly providerId: string) {
    super(`Unsupported model provider: ${providerId}`);
    this.name = 'UnsupportedModelProviderError';
  }
}

export class WorkspaceProvidersDisabledError extends Error {
  constructor(public readonly managedProviderId: string) {
    super(`This instance only supports provider \`${managedProviderId}\`.`);
    this.name = 'WorkspaceProvidersDisabledError';
  }
}

export class UnsupportedHarnessProviderError extends Error {
  constructor(
    public readonly harness: Harness,
    public readonly providerId: string,
    public readonly supportedProviderIds: readonly string[],
  ) {
    super(
      `Harness ${harness} does not support model provider ${providerId}. Supported providers: ${supportedProviderIds.join(', ')}`,
    );
    this.name = 'UnsupportedHarnessProviderError';
  }
}

export class UnsupportedHarnessThinkingError extends Error {
  constructor(
    public readonly harness: Harness,
    public readonly thinking: string,
    public readonly supportedLevels: readonly AgentThinking[],
  ) {
    super(
      `Harness ${harness} does not support thinking ${thinking}. Supported levels: ${supportedLevels.join(', ')}`,
    );
    this.name = 'UnsupportedHarnessThinkingError';
  }
}

export class InvalidCredentialFieldsError extends Error {
  constructor(public readonly providerId: SupportedModelProviderId) {
    super(`Invalid credential fields for model provider: ${providerId}`);
    this.name = 'InvalidCredentialFieldsError';
  }
}

export class InvalidAgentModelError extends Error {
  public readonly harness: Harness;
  public readonly providerId: ModelProviderRef;
  public readonly model: string;

  constructor(providerId: ModelProviderRef, model: string);
  constructor(harness: Harness, providerId: ModelProviderRef, model: string);
  constructor(
    harnessOrProviderId: Harness | ModelProviderRef,
    providerIdOrModel: ModelProviderRef | string,
    model?: string,
  ) {
    const harness = model === undefined ? 'pi' : (harnessOrProviderId as Harness);
    const providerId =
      model === undefined
        ? (harnessOrProviderId as ModelProviderRef)
        : (providerIdOrModel as ModelProviderRef);
    const resolvedModel = model ?? (providerIdOrModel as string);

    super(`Model is not available for harness ${harness}: ${providerId}/${resolvedModel}`);
    this.name = 'InvalidAgentModelError';
    this.harness = harness;
    this.providerId = providerId;
    this.model = resolvedModel;
  }
}

export class ModelProviderValidationUnavailableError extends Error {
  constructor(public readonly providerId: SupportedModelProviderId) {
    super(`Model provider validation is not available for model provider: ${providerId}`);
    this.name = 'ModelProviderValidationUnavailableError';
  }
}

export class CustomModelProviderSlugCollisionError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly providerId: ModelProviderRef,
  ) {
    super(`Custom model provider slug already exists: ${workspaceId}/${providerId}`);
    this.name = 'CustomModelProviderSlugCollisionError';
  }
}

export class CustomModelProviderConfigNotFoundError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly providerId: ModelProviderRef,
  ) {
    super(`Custom model provider config not found: ${workspaceId}/${providerId}`);
    this.name = 'CustomModelProviderConfigNotFoundError';
  }
}

export class InvalidCustomModelProviderHeaderKeepError extends Error {
  constructor(
    public readonly providerId: ModelProviderRef,
    public readonly headerName: string,
  ) {
    super(`Custom model provider secret header cannot be kept: ${providerId}/${headerName}`);
    this.name = 'InvalidCustomModelProviderHeaderKeepError';
  }
}

export class AgentSessionHeldError extends Error {
  constructor(params: {
    sessionId: string;
    workflowRunAttemptId: string;
    key: string;
    heldByStepAttempt: string | null;
  }) {
    super(
      params.heldByStepAttempt === null
        ? `Agent session is claimed by another live attempt: ${params.workflowRunAttemptId}/${params.key} (holder not yet committed)`
        : `Agent session is claimed by another live attempt: ${params.workflowRunAttemptId}/${params.key} (held by ${params.heldByStepAttempt})`,
    );
    this.name = 'AgentSessionHeldError';
    this.sessionId = params.sessionId;
    this.workflowRunAttemptId = params.workflowRunAttemptId;
    this.key = params.key;
    this.heldByStepAttempt = params.heldByStepAttempt;
  }

  /** The claimed session row. */
  public readonly sessionId: string;
  public readonly workflowRunAttemptId: string;
  public readonly key: string;
  /** The step attempt currently holding the exclusive claim. */
  public readonly heldByStepAttempt: string | null;
}

export class AgentSessionKeyInvalidError extends Error {
  readonly code = 'agent_session_key_invalid';

  constructor() {
    super('Agent session key is invalid');
    this.name = 'AgentSessionKeyInvalidError';
  }
}

export class AgentSessionHarnessInvalidError extends Error {
  readonly code = 'agent_session_harness_invalid';

  constructor() {
    super('Agent session harness is invalid');
    this.name = 'AgentSessionHarnessInvalidError';
  }
}

export class AgentSessionHarnessMismatchError extends Error {
  readonly code = 'agent_session_harness_mismatch';

  constructor(params: {
    sessionId: string;
    workflowRunAttemptId: string;
    key: string;
    pinnedHarness: Harness;
    requestedHarness: Harness;
  }) {
    super('Agent session harness does not match the pinned harness');
    this.name = 'AgentSessionHarnessMismatchError';
    this.sessionId = params.sessionId;
    this.workflowRunAttemptId = params.workflowRunAttemptId;
    this.key = params.key;
    this.pinnedHarness = params.pinnedHarness;
    this.requestedHarness = params.requestedHarness;
  }

  public readonly sessionId: string;
  public readonly workflowRunAttemptId: string;
  public readonly key: string;
  public readonly pinnedHarness: Harness;
  public readonly requestedHarness: Harness;
}

export class AgentSessionLockUnavailableError extends Error {
  readonly code = 'agent_session_lock_unavailable';

  constructor(params: {sessionId: string; workflowRunAttemptId: string; key: string}) {
    super('Agent session is temporarily locked by another operation');
    this.name = 'AgentSessionLockUnavailableError';
    this.sessionId = params.sessionId;
    this.workflowRunAttemptId = params.workflowRunAttemptId;
    this.key = params.key;
  }

  public readonly sessionId: string;
  public readonly workflowRunAttemptId: string;
  public readonly key: string;
}

export class AgentSessionCarryOverConflictError extends Error {
  readonly code = 'agent_session_carry_over_conflict';

  constructor(params: {
    targetWorkflowRunAttemptId: string;
    key: string;
    sourceSessionId: string;
    existingSessionId: string;
  }) {
    super('Agent session carry-over conflicts with an existing target session');
    this.name = 'AgentSessionCarryOverConflictError';
    this.targetWorkflowRunAttemptId = params.targetWorkflowRunAttemptId;
    this.key = params.key;
    this.sourceSessionId = params.sourceSessionId;
    this.existingSessionId = params.existingSessionId;
  }

  public readonly targetWorkflowRunAttemptId: string;
  public readonly key: string;
  public readonly sourceSessionId: string;
  public readonly existingSessionId: string;
}

export type AgentSessionUnavailableReason =
  | 'blob_cap_exceeded'
  | 'encryption_failed'
  | 'decryption_failed'
  | 'object_missing'
  | 'storage_unavailable';

/**
 * A session transcript could not be stored or loaded: the compressed blob is
 * over the cap, envelope crypto failed, the object is missing, or the object
 * store is unreachable. Maps to the `agent_session_unavailable` step error; the
 * attempt fails deterministically and is never retried transparently.
 */
export class AgentSessionUnavailableError extends Error {
  readonly code = 'agent_session_unavailable';

  constructor(
    /** Stable reason; safe for logs and error reporting. */
    public readonly reason: AgentSessionUnavailableReason,
  ) {
    super(`Agent session transcript is unavailable: ${reason}`);
    this.name = 'AgentSessionUnavailableError';
  }
}

export class CustomModelProviderStoredSecretBaseUrlChangeError extends Error {
  constructor(public readonly providerId: ModelProviderRef) {
    super(
      `Stored custom model provider secrets cannot be reused with a changed base URL: ${providerId}`,
    );
    this.name = 'CustomModelProviderStoredSecretBaseUrlChangeError';
  }
}
