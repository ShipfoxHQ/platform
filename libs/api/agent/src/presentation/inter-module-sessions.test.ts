import crypto from 'node:crypto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {db, sessions} from '#db/index.js';
import {agentTestSecretsClient} from '#test/fixtures/secrets-client.js';
import {createAgentInterModulePresentation} from './inter-module.js';

const signal = new AbortController().signal;

function createPresentation() {
  return createAgentInterModulePresentation({
    secrets: agentTestSecretsClient,
    workspaceProviders: 'enabled',
  });
}

interface ClaimInput {
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
  key: string;
  harness: 'pi' | 'claude';
  stepAttemptId: string;
  mode: 'resume' | 'fork';
}

function newClaimInput(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    key: 'main',
    harness: 'pi',
    stepAttemptId: crypto.randomUUID(),
    mode: 'resume',
    ...overrides,
  };
}

function claim(presentation: ReturnType<typeof createPresentation>, input: ClaimInput) {
  return Promise.resolve(presentation.handlers.claimSession(input, {signal}));
}

async function findSessionRow(sessionId: string) {
  const [row] = await db().select().from(sessions).where(eq(sessions.id, sessionId));
  return row ?? null;
}

describe('agent inter-module claimSession', () => {
  it('claims a resume session on first use and returns the descriptor with the pinned harness', async () => {
    const input = newClaimInput({harness: 'claude'});

    const result = await claim(createPresentation(), input);

    expect(result).toEqual({
      descriptor: {id: expect.any(String), key: 'main', mode: 'resume', segment: 0},
      harness: 'claude',
    });
    const row = await findSessionRow(result.descriptor?.id ?? '');
    expect(row).toMatchObject({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workflowRunAttemptId: input.workflowRunAttemptId,
      key: 'main',
      harness: 'claude',
      claimedByStepAttempt: input.stepAttemptId,
    });
  });

  it('grants a re-claim by the same attempt with the same session id', async () => {
    const input = newClaimInput();
    const presentation = createPresentation();
    const first = await claim(presentation, input);

    const second = await claim(presentation, input);

    expect(second.descriptor?.id).toBe(first.descriptor?.id);
    expect(second.descriptor).toEqual({
      id: first.descriptor?.id,
      key: 'main',
      mode: 'resume',
      segment: 0,
    });
    expect(second.harness).toBe('pi');
  });

  it('fails a resume with session-held when another live attempt holds the claim', async () => {
    const input = newClaimInput();
    const presentation = createPresentation();
    await claim(presentation, {...input, stepAttemptId: crypto.randomUUID()});

    const result = await claim(presentation, input).catch((error: unknown) => error);

    expect(isInterModuleKnownError(agentInterModuleContract.methods.claimSession, result)).toBe(
      true,
    );
    if (!isInterModuleKnownError(agentInterModuleContract.methods.claimSession, result)) {
      throw new Error('Expected a claim known error');
    }
    expect(result.code).toBe('session-held');
  });

  it('fails a resume with session-harness-mismatch when the resolved harness differs from the pinned one', async () => {
    const input = newClaimInput({harness: 'pi'});
    const presentation = createPresentation();
    await claim(presentation, input);

    const result = await claim(presentation, {...input, harness: 'claude'}).catch(
      (error: unknown) => error,
    );

    expect(isInterModuleKnownError(agentInterModuleContract.methods.claimSession, result)).toBe(
      true,
    );
    if (!isInterModuleKnownError(agentInterModuleContract.methods.claimSession, result)) {
      throw new Error('Expected a claim known error');
    }
    expect(result.code).toBe('session-harness-mismatch');
  });

  it('fails a resume with session-key-invalid for a key outside the grammar', async () => {
    const result = await claim(createPresentation(), newClaimInput({key: 'bad/key'})).catch(
      (error: unknown) => error,
    );

    expect(isInterModuleKnownError(agentInterModuleContract.methods.claimSession, result)).toBe(
      true,
    );
    if (!isInterModuleKnownError(agentInterModuleContract.methods.claimSession, result)) {
      throw new Error('Expected a claim known error');
    }
    expect(result.code).toBe('session-key-invalid');
  });

  it('reads a fork descriptor without claiming and without writing', async () => {
    const input = newClaimInput({mode: 'fork'});
    const presentation = createPresentation();
    const resumeInput = {...input, mode: 'resume' as const, stepAttemptId: crypto.randomUUID()};
    const claimed = await claim(presentation, resumeInput);

    const result = await claim(presentation, input);

    expect(result).toEqual({
      descriptor: {id: claimed.descriptor?.id, key: 'main', mode: 'fork', segment: 0},
      harness: 'pi',
    });
    const row = await findSessionRow(result.descriptor?.id ?? '');
    expect(row?.claimedByStepAttempt).toBe(resumeInput.stepAttemptId);
  });

  it('returns a null descriptor for a fork of a session that does not exist yet', async () => {
    const input = newClaimInput({mode: 'fork', key: 'missing'});

    const result = await claim(createPresentation(), input);

    expect(result).toEqual({descriptor: null, harness: 'pi'});
    const rows = await db()
      .select()
      .from(sessions)
      .where(eq(sessions.workflowRunAttemptId, input.workflowRunAttemptId));
    expect(rows).toHaveLength(0);
  });

  it('fails a fork with session-harness-mismatch when the pinned harness differs from the resolved one', async () => {
    const input = newClaimInput({mode: 'fork', harness: 'pi'});
    const presentation = createPresentation();
    await claim(presentation, {
      ...input,
      mode: 'resume' as const,
      stepAttemptId: crypto.randomUUID(),
    });

    const result = await claim(presentation, {...input, harness: 'claude'}).catch(
      (error: unknown) => error,
    );

    expect(isInterModuleKnownError(agentInterModuleContract.methods.claimSession, result)).toBe(
      true,
    );
    if (!isInterModuleKnownError(agentInterModuleContract.methods.claimSession, result)) {
      throw new Error('Expected a claim known error');
    }
    expect(result.code).toBe('session-harness-mismatch');
  });

  it('returns a null descriptor for a fork of a session held under another workspace', async () => {
    const input = newClaimInput({mode: 'fork'});
    const presentation = createPresentation();
    await claim(presentation, {
      ...input,
      mode: 'resume' as const,
      stepAttemptId: crypto.randomUUID(),
    });

    const result = await claim(presentation, {...input, workspaceId: crypto.randomUUID()});

    expect(result).toEqual({descriptor: null, harness: 'pi'});
  });
});

describe('agent inter-module carryOverSessions', () => {
  it('copies sessions into the target run attempt and reports their descriptors', async () => {
    const input = newClaimInput();
    const presentation = createPresentation();
    const claimed = await claim(presentation, input);
    const fromWorkflowRunAttemptId = input.workflowRunAttemptId;
    const toWorkflowRunAttemptId = crypto.randomUUID();

    const result = await presentation.handlers.carryOverSessions(
      {fromWorkflowRunAttemptId, toWorkflowRunAttemptId},
      {signal},
    );

    expect(result.sessions).toEqual([{id: expect.any(String), key: 'main', segment: 0}]);
    const copied = await db()
      .select()
      .from(sessions)
      .where(eq(sessions.workflowRunAttemptId, toWorkflowRunAttemptId));
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({
      id: result.sessions[0]?.id,
      key: 'main',
      harness: 'pi',
      carriedFromSessionId: claimed.descriptor?.id,
      claimedByStepAttempt: null,
    });
  });

  it('fails with carry-over-conflict when the target attempt already has a session of its own', async () => {
    const input = newClaimInput();
    const presentation = createPresentation();
    const fromWorkflowRunAttemptId = input.workflowRunAttemptId;
    const toWorkflowRunAttemptId = crypto.randomUUID();
    await claim(presentation, input);
    await claim(
      presentation,
      newClaimInput({
        workflowRunAttemptId: toWorkflowRunAttemptId,
        stepAttemptId: crypto.randomUUID(),
      }),
    );

    const result = await Promise.resolve(
      presentation.handlers.carryOverSessions(
        {fromWorkflowRunAttemptId, toWorkflowRunAttemptId},
        {signal},
      ),
    ).catch((error: unknown) => error);

    expect(
      isInterModuleKnownError(agentInterModuleContract.methods.carryOverSessions, result),
    ).toBe(true);
    if (!isInterModuleKnownError(agentInterModuleContract.methods.carryOverSessions, result)) {
      throw new Error('Expected a carry-over known error');
    }
    expect(result.code).toBe('carry-over-conflict');
  });
});
