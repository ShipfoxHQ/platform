import {agentInterModuleContract, agentSessionDescriptorSchema} from './inter-module.js';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('agentInterModuleContract', () => {
  test('carries workspace context and the effective default harness for validation', () => {
    const input = agentInterModuleContract.methods.getValidationCatalog.input.parse({
      workspaceId: UUID,
    });
    const output = agentInterModuleContract.methods.getValidationCatalog.output.parse({
      version: 1,
      default_harness_id: 'pi',
      providers: [],
      harnesses: [],
    });

    expect(input).toEqual({workspaceId: UUID});
    expect(output.default_harness_id).toBe('pi');
  });

  test('accepts valid claimSession payloads in both modes', () => {
    const input = {
      workspaceId: UUID,
      projectId: '00000000-0000-4000-8000-000000000002',
      workflowRunAttemptId: '00000000-0000-4000-8000-000000000003',
      key: 'main',
      harness: 'pi' as const,
      stepAttemptId: '00000000-0000-4000-8000-000000000004',
      mode: 'resume' as const,
    };
    const parsed = agentInterModuleContract.methods.claimSession.input.parse(input);
    const forkParsed = agentInterModuleContract.methods.claimSession.input.parse({
      ...input,
      mode: 'fork',
    });

    expect(parsed).toEqual(input);
    expect(forkParsed.mode).toBe('fork');
  });

  test('accepts the claimSession output with a descriptor and the pinned harness', () => {
    const parsed = agentInterModuleContract.methods.claimSession.output.parse({
      descriptor: {id: UUID, key: 'main', mode: 'resume', segment: 0},
      harness: 'claude',
    });

    expect(parsed).toEqual({
      descriptor: {id: UUID, key: 'main', mode: 'resume', segment: 0},
      harness: 'claude',
    });
  });

  test('accepts a null descriptor for a fork of a session that does not exist', () => {
    const parsed = agentInterModuleContract.methods.claimSession.output.parse({
      descriptor: null,
      harness: 'pi',
    });

    expect(parsed).toEqual({descriptor: null, harness: 'pi'});
  });

  test('accepts valid carryOverSessions payloads and output', () => {
    const input = {
      fromWorkflowRunAttemptId: '00000000-0000-4000-8000-000000000005',
      toWorkflowRunAttemptId: '00000000-0000-4000-8000-000000000006',
    };
    const parsed = agentInterModuleContract.methods.carryOverSessions.input.parse(input);
    const output = agentInterModuleContract.methods.carryOverSessions.output.parse({
      sessions: [{id: UUID, key: 'main', segment: 0}],
    });

    expect(parsed).toEqual(input);
    expect(output).toEqual({sessions: [{id: UUID, key: 'main', segment: 0}]});
  });

  test.each([
    ['session-key-invalid', {}],
    ['session-held', {}],
    ['session-harness-mismatch', {}],
    ['session-lock-unavailable', {}],
  ] as const)('declares the %s claimSession failure shape', (code, details) => {
    const schema = agentInterModuleContract.methods.claimSession.errors[code];
    const parsed = schema.parse(details);

    expect(parsed).toEqual(details);
  });

  test('declares the carry-over-conflict failure shape', () => {
    const schema = agentInterModuleContract.methods.carryOverSessions.errors['carry-over-conflict'];
    const parsed = schema.parse({});

    expect(parsed).toEqual({});
  });

  test('validates the session descriptor schema', () => {
    const parsed = agentSessionDescriptorSchema.parse({
      id: UUID,
      key: 'main',
      mode: 'fork',
      segment: 3,
    });

    expect(parsed).toEqual({id: UUID, key: 'main', mode: 'fork', segment: 3});
  });

  test('rejects a descriptor with a negative segment', () => {
    expect(() =>
      agentSessionDescriptorSchema.parse({id: UUID, key: 'main', mode: 'fork', segment: -1}),
    ).toThrow();
  });
});
