import type {ExtensionAPI, InlineExtension} from '@earendil-works/pi-coding-agent';
import {logger} from '@shipfox/node-opentelemetry';
import {
  AGENT_SESSION_DIAGNOSTICS_ENTRY_TYPE,
  type AgentSessionDiagnostics,
  stableToolErrorDetails,
} from '#core/agent-session-diagnostics.js';

export const PI_SESSION_DIAGNOSTICS_EXTENSION_NAME = 'shipfox-pi-session-diagnostics';

/**
 * Captures Pi tool lifecycle events in memory and writes one structured custom
 * entry to the protected native transcript during session shutdown. The hook
 * also upgrades adapter-level protocol failures to Pi's `isError` signal.
 */
export function createPiSessionDiagnosticsExtension(
  diagnostics: AgentSessionDiagnostics,
): InlineExtension {
  return {
    name: PI_SESSION_DIAGNOSTICS_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      let persisted = false;

      pi.on('turn_start', () => {
        diagnostics.recordTurnStart();
      });

      pi.on('tool_call', (event) => {
        diagnostics.recordToolCall({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.input,
        });
      });

      pi.on('tool_result', (event) => {
        diagnostics.recordToolResult({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          details: event.details,
        });
        recordOutputWrite(diagnostics, event.toolName, event.input, event.details);

        const stableError = stableToolErrorDetails(
          event.details,
          event.isError || isRejectedOutput(event.details),
        );
        if (event.isError || isRejectedOutput(event.details) || stableError !== undefined) {
          return {isError: true};
        }
        return undefined;
      });

      pi.on('turn_end', (event) => {
        diagnostics.recordUsage(event.message);
      });

      pi.on('agent_end', (event) => {
        diagnostics.recordUsage(event);
      });

      pi.on('session_shutdown', () => {
        if (persisted) return;
        persisted = true;
        try {
          pi.appendEntry(AGENT_SESSION_DIAGNOSTICS_ENTRY_TYPE, diagnostics.snapshot());
        } catch {
          // Diagnostics must never change the agent outcome or shutdown path.
          safeLog('Failed to persist Pi agent session diagnostics');
        }
      });
    },
  };
}

function recordOutputWrite(
  diagnostics: AgentSessionDiagnostics,
  toolName: string,
  input: unknown,
  details: unknown,
): void {
  if (toolName !== 'set_output' || !isRecord(input) || typeof input.key !== 'string') return;
  if (!isRecord(details) || typeof details.ok !== 'boolean') return;
  diagnostics.recordOutputWrite({
    key: input.key,
    value: typeof input.value === 'string' ? input.value : '',
    result: {
      ok: details.ok,
      ...(typeof details.idempotent === 'boolean' ? {idempotent: details.idempotent} : {}),
      ...(typeof details.code === 'string' ? {code: details.code} : {}),
    },
  });
}

function isRejectedOutput(value: unknown): boolean {
  return isRecord(value) && value.ok === false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeLog(message: string): void {
  try {
    logger().warn({event: 'runner.agent_session_diagnostics'}, message);
  } catch {
    // Diagnostics must not affect Pi shutdown.
  }
}
