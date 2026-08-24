import type {
  ClaudeRuntimeConfigDto,
  CustomModelProviderRuntimeConfigDto,
} from '@shipfox/api-agent-dto';
import type {OutputDeclarations} from '@shipfox/expression';
import type {IntegrationToolsBridge} from '#core/integration-tools-bridge.js';

// The invocation shape is still pi-oriented because v1 only has two harnesses.
// Revisit this shared contract if a third harness needs materially different inputs.
export interface HarnessInvocation {
  readonly cwd: string;
  /** Runner-owned per-job directory for harness state, outside the checked-out workspace. */
  readonly agentStateDir?: string | undefined;
  readonly model: string;
  readonly provider: string;
  readonly thinking: string;
  readonly prompt: string;
  readonly tools?: readonly string[] | undefined;
  readonly mcpServers?: readonly IntegrationToolsBridge[] | undefined;
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
