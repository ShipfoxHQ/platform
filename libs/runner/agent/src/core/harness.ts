import type {
  ClaudeRuntimeConfigDto,
  CustomModelProviderRuntimeConfigDto,
} from '@shipfox/api-agent-dto';
import type {OutputDeclarations} from '@shipfox/expression';
import type {IntegrationToolsBridge} from '#core/integration-tools-bridge.js';
import type {AgentPrerequisiteContract} from '#core/prerequisite-ledger.js';

// The invocation shape is still pi-oriented because v1 only has two harnesses.
// Revisit this shared contract if a third harness needs materially different inputs.
export interface HarnessSessionInvocation {
  readonly mode: 'resume' | 'fork';
  /** Local, runner-owned transcript downloaded before the harness starts. */
  readonly file?: string | undefined;
  /** Native session id associated with the downloaded transcript, when present. */
  readonly harnessSessionId?: string | undefined;
}

/** Safe identifiers copied from the materialized integration allowlist. */
export interface RequestedIntegrationTool {
  readonly connectionSlug: string;
  readonly toolId: string;
}

/** How an agent may reach tools exposed by an MCP bridge. */
export type HarnessToolSurface = 'strict-direct' | 'discovery';

export interface InferenceCredential {
  readonly token: string;
  readonly generation: string;
}

/**
 * Runner-owned source for a managed inference credential. Harness adapters may resolve it for
 * each model request without receiving the job lease or owning renewal state.
 */
export interface InferenceCredentialSource {
  resolve(options?: {
    readonly rejectedGeneration?: string | undefined;
  }): Promise<InferenceCredential>;
  close(): void;
}

export interface HarnessInvocation {
  /** Workflow execution identity used to correlate runner diagnostics. */
  readonly jobExecutionId?: string | undefined;
  readonly stepId?: string | undefined;
  readonly attempt?: number | undefined;
  readonly cwd: string;
  /** Runner-owned per-job directory for harness state, outside the checked-out workspace. */
  readonly agentStateDir?: string | undefined;
  /** Downloaded native session state and its continuation mode. */
  readonly session?: HarnessSessionInvocation | undefined;
  readonly model: string;
  readonly provider: string;
  readonly thinking: string;
  readonly prompt: string;
  readonly tools?: readonly string[] | undefined;
  readonly mcpServers?: readonly IntegrationToolsBridge[] | undefined;
  /** Defaults to strict direct tools; discovery keeps the generic `mcp` proxy. */
  readonly toolSurface?: HarnessToolSurface | undefined;
  /** Materialized integration tool IDs requested by this step, without schemas or secrets. */
  readonly requestedIntegrationTools?: readonly RequestedIntegrationTool[] | undefined;
  readonly credentialSource?: InferenceCredentialSource | undefined;
  /** Deterministic runtime facts required before an output-complete Pi turn may stop. */
  readonly prerequisites?: AgentPrerequisiteContract | undefined;
  readonly outputs?: OutputDeclarations | undefined;
  readonly credentials: Record<string, string>;
  readonly customProvider?: CustomModelProviderRuntimeConfigDto | undefined;
  readonly claude?: ClaudeRuntimeConfigDto | undefined;
  readonly gitConfigGlobal?: string | undefined;
  readonly signal: AbortSignal;
  /** Forwards each verbatim session entry line as persisted, in order. Best-effort. */
  readonly onSessionEntry?: (line: string) => void;
}

export interface HarnessResult {
  readonly response?: string;
  readonly outputs?: Record<string, string>;
  /** Persisted session artifact produced by the harness, when session transport is enabled. */
  readonly sessionFile?: string | undefined;
  readonly sessionId?: string | undefined;
}

export interface HarnessAdapter {
  /**
   * Runs one agent step for the selected harness.
   *
   * Implementations must observe `invocation.signal` for cooperative cancellation.
   * `step.ts` also races this call against the signal so the step loop can continue
   * even if an adapter is slow to settle after abort.
   */
  run(invocation: HarnessInvocation): Promise<HarnessResult>;
}
