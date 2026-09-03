import {
  AgentSessionDiagnostics,
  type AgentSessionFailureClass,
  stableDiagnosticFingerprint,
} from '#core/agent-session-diagnostics.js';

function diagnostics(
  overrides: Partial<ConstructorParameters<typeof AgentSessionDiagnostics>[0]> = {},
): AgentSessionDiagnostics {
  return new AgentSessionDiagnostics({
    harness: 'pi',
    invocation: {
      jobExecutionId: 'job-1',
      stepId: 'step-1',
      attempt: 2,
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      session: {mode: 'resume'},
    },
    metadataMode: 'warm',
    ...overrides,
  });
}

describe('AgentSessionDiagnostics', () => {
  it('retains one structured protected record for calls, errors, writes, and budgets', () => {
    const record = diagnostics({
      providerTools: [
        {
          name: 'pull_request_read',
          description: 'Read a pull request.',
          inputSchema: {type: 'object', properties: {method: {type: 'string'}}},
          outputSchema: {type: 'object'},
        },
      ],
      directToolNames: ['pull_request_read'],
      proxyFallback: true,
    });
    record.recordSessionId('session-1');
    record.recordTurnStart();
    record.recordToolCall({
      toolCallId: 'call-1',
      toolName: 'pull_request_read',
      args: {repo: 'platform', method: 'get'},
    });
    record.recordToolResult({
      toolCallId: 'call-1',
      isError: true,
      details: {
        message: 'wording one',
        structuredContent: {
          code: 'invalid-request',
          reason: 'missing_required_parameter',
          tool: 'pull_request_read',
          parameter: 'method',
        },
      },
    });
    record.recordOutputWrite({
      key: 'summary',
      value: 'done',
      result: {ok: true},
    });
    record.recordOutputWrite({
      key: 'summary',
      value: 'done',
      result: {ok: true, idempotent: true},
    });
    record.finish('completed');

    expect(record.storeEntry()).toMatchObject({
      type: 'shipfox_agent_diagnostics',
      data: {
        kind: 'agent_session_diagnostics',
        version: 1,
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        sessionId: 'session-1',
        registration: {
          metadataMode: 'warm',
          directToolNames: ['pull_request_read'],
          proxyFallback: true,
        },
        providerTools: [
          {
            name: 'pull_request_read',
            description: 'Read a pull request.',
            inputSchema: {type: 'object', properties: {method: {type: 'string'}}},
            outputSchema: {type: 'object'},
          },
        ],
        toolCalls: [
          {
            toolName: 'pull_request_read',
            normalizedArgs: {method: 'get', repo: 'platform'},
            argsFingerprint: expect.any(String),
          },
        ],
        toolResults: [
          expect.objectContaining({
            isError: true,
            error: {
              code: 'invalid-request',
              reason: 'missing_required_parameter',
              tool: 'pull_request_read',
              parameter: 'method',
            },
            resultFingerprint: expect.any(String),
          }),
        ],
        outputWrites: [
          {status: 'accepted', key: 'summary', valueFingerprint: expect.any(String)},
          {status: 'idempotent', key: 'summary', valueFingerprint: expect.any(String)},
        ],
        termination: {reason: 'completed'},
        budgets: {
          turns: {consumed: 1, remaining: null},
          toolCalls: {consumed: 1, remaining: null},
          timeMs: {consumed: expect.any(Number), remaining: null},
          tokens: {consumed: 0, remaining: null},
        },
      },
    });
  });

  it('keeps repetition fingerprints stable when provider prose changes', () => {
    const record = diagnostics();
    for (const [index, message] of [
      'first wording',
      'rephrased wording',
      'third wording',
    ].entries()) {
      const toolCallId = `call-${index}`;
      record.recordToolCall({toolCallId, toolName: 'pull_request_read', args: {method: 'get'}});
      record.recordToolResult({
        toolCallId,
        isError: true,
        details: {
          message,
          structuredContent: {
            code: 'invalid-request',
            reason: 'missing_required_parameter',
            tool: 'pull_request_read',
            parameter: 'method',
          },
        },
      });
    }

    const snapshot = record.snapshot();
    expect(snapshot.toolResults.map((result) => result.resultFingerprint)).toEqual([
      snapshot.toolResults[0]?.resultFingerprint,
      snapshot.toolResults[0]?.resultFingerprint,
      snapshot.toolResults[0]?.resultFingerprint,
    ]);
    expect(snapshot.failureClasses).toContain('agent_tool_loop_detected');
    expect(
      stableDiagnosticFingerprint({code: 'invalid-request', reason: 'missing_required_parameter'}),
    ).toBe(
      stableDiagnosticFingerprint({reason: 'missing_required_parameter', code: 'invalid-request'}),
    );
  });

  it('fills exact arguments when a progress event precedes the assistant tool call', () => {
    const record = diagnostics();
    record.recordToolCall({toolCallId: 'call-1', toolName: 'pull_request_read', args: {}});
    record.updateToolCallArguments('call-1', {method: 'get', repo: 'platform'});

    expect(record.snapshot().toolCalls).toMatchObject([
      {
        toolCallId: 'call-1',
        normalizedArgs: {method: 'get', repo: 'platform'},
      },
    ]);
  });

  it.each<AgentSessionFailureClass>([
    'required_output_missing',
    'agent_tool_loop_detected',
    'output_conflict',
    'integration_tool_catalog_unavailable',
  ])('supports the typed failure class %s', (failureClass) => {
    const record = diagnostics({
      catalogFailures:
        failureClass === 'integration_tool_catalog_unavailable'
          ? [{server: 'shipfox_integration_tools', errorClass: 'timeout'}]
          : undefined,
    });
    if (failureClass === 'output_conflict') {
      record.recordOutputWrite({
        key: 'summary',
        value: 'first',
        result: {ok: false, code: 'output_conflict'},
      });
    } else if (failureClass !== 'integration_tool_catalog_unavailable') {
      record.markFailure(failureClass);
    }
    record.finish(failureClass, failureClass);

    expect(record.snapshot().failureClasses).toContain(failureClass);
    expect(record.snapshot().termination).toMatchObject({
      reason: failureClass,
      failureClass,
    });
  });
});
