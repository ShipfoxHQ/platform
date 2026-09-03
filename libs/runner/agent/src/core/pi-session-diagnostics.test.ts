import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {AgentSessionDiagnostics} from '#core/agent-session-diagnostics.js';
import {
  createPiSessionDiagnosticsExtension,
  PI_SESSION_DIAGNOSTICS_EXTENSION_NAME,
} from '#core/pi-session-diagnostics.js';

function diagnostics(): AgentSessionDiagnostics {
  return new AgentSessionDiagnostics({
    harness: 'pi',
    invocation: {
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      session: {mode: 'resume'},
    },
    metadataMode: 'warm',
  });
}

describe('Pi session diagnostics extension', () => {
  it('persists protocol failures and upgrades proxy/output failures to isError', async () => {
    const record = diagnostics();
    const handlers = new Map<string, (event: never) => unknown>();
    const appendEntry = vi.fn();
    const extension = createPiSessionDiagnosticsExtension(record);
    const pi = {
      on: (event: string, handler: (event: never) => unknown) => handlers.set(event, handler),
      appendEntry,
    } as unknown as ExtensionAPI;

    expect(extension.name).toBe(PI_SESSION_DIAGNOSTICS_EXTENSION_NAME);
    if (typeof extension === 'function') throw new Error('Expected an inline extension object');
    await extension.factory(pi);

    handlers.get('tool_call')?.({
      toolCallId: 'proxy-call',
      toolName: 'mcp',
      input: {name: 'pull_request_read', args: {method: 'get'}},
    } as never);
    const proxyResult = handlers.get('tool_result')?.({
      toolCallId: 'proxy-call',
      toolName: 'mcp',
      input: {name: 'pull_request_read'},
      content: [{type: 'text', text: 'Method is required: wording can change'}],
      details: {
        mode: 'call',
        error: 'tool_error',
        mcpResult: {
          isError: true,
          structuredContent: {
            code: 'invalid-request',
            reason: 'missing_required_parameter',
            tool: 'pull_request_read',
            parameter: 'method',
          },
        },
      },
      isError: false,
    } as never) as {isError?: boolean} | undefined;
    const outputResult = handlers.get('tool_result')?.({
      toolCallId: 'output-call',
      toolName: 'set_output',
      input: {key: 'summary', value: 'second'},
      content: [{type: 'text', text: 'conflicting output'}],
      details: {
        ok: false,
        isError: true,
        code: 'output_conflict',
        details: {code: 'output_conflict', key: 'summary'},
      },
      isError: false,
    } as never) as {isError?: boolean} | undefined;
    record.finish('error', 'output_conflict');
    handlers.get('session_shutdown')?.({} as never);

    expect(proxyResult).toEqual({isError: true});
    expect(outputResult).toEqual({isError: true});
    expect(appendEntry).toHaveBeenCalledWith('shipfox_agent_diagnostics', expect.any(Object));
    const entry = appendEntry.mock.calls[0]?.[1] as {
      toolResults: Array<{isError: boolean; error?: unknown}>;
      outputWrites: Array<{key: string; status: string}>;
      termination: unknown;
    };
    expect(entry.toolResults[0]).toMatchObject({
      isError: true,
      error: {
        code: 'invalid-request',
        reason: 'missing_required_parameter',
        tool: 'pull_request_read',
        parameter: 'method',
      },
    });
    expect(entry.toolResults[1]).toMatchObject({isError: true, error: {code: 'output_conflict'}});
    expect(entry.outputWrites).toEqual([
      expect.objectContaining({key: 'summary', status: 'conflicting'}),
    ]);
    expect(entry.termination).toEqual({reason: 'error', failureClass: 'output_conflict'});
  });
});
