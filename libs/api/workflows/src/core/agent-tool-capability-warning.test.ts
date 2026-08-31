import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import type {JobLeaseTokenClaims} from '@shipfox/api-auth-dto';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {runnersTestClient, setRunnerToolCapabilities} from '#test/fixtures/runners-inter-module.js';
import {warnAgentToolCapabilityMismatchOnDispatch as warnAgentToolCapabilityMismatchOnDispatchImpl} from './agent-tool-capability-warning.js';
import type {Step} from './entities/step.js';

async function warnAgentToolCapabilityMismatchOnDispatch(
  params: Omit<
    Parameters<typeof warnAgentToolCapabilityMismatchOnDispatchImpl>[0],
    'annotations' | 'runners'
  >,
) {
  return await warnAgentToolCapabilityMismatchOnDispatchImpl({
    annotations: annotationsTestClient,
    runners: runnersTestClient,
    ...params,
  });
}

const annotationBodiesByExecution = new Map<string, Map<string, string>>();

const annotationsTestClient: AnnotationsInterModuleClient = {
  replaceOrRemoveAnnotation(input) {
    const annotations = annotationBodiesByExecution.get(input.jobExecutionId) ?? new Map();
    annotationBodiesByExecution.set(input.jobExecutionId, annotations);
    if (input.annotation.op === 'remove') {
      annotations.delete(input.context);
    } else {
      annotations.set(input.context, input.annotation.body);
    }
    return Promise.resolve({});
  },
  listAnnotationsForRunAttempt: vi.fn(),
};

function lease(params: Partial<JobLeaseTokenClaims> = {}): JobLeaseTokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: 'runner-job-lease',
    iat: now,
    exp: now + 60,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttempt: 1,
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    runnerSessionId: crypto.randomUUID(),
    currentStepId: crypto.randomUUID(),
    currentStepAttempt: 1,
    ...params,
  };
}

function agentStep(params: Partial<Step> = {}): Step {
  return {
    id: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    key: 'fix',
    name: 'Fix',
    sourceLocation: null,
    status: 'running',
    statusReason: null,
    evaluationTrace: null,
    type: 'agent',
    config: {
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      tools: ['read', 'web_search'],
      prompt: 'Fix it.',
    },
    condition: null,
    configPlan: null,
    authoredConfig: null,
    error: null,
    position: 0,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...params,
  };
}

function setRunnerSessionCapabilities(params: {
  runnerSessionId: string;
  workspaceId: string;
  toolCapabilities:
    | Awaited<
        ReturnType<RunnersInterModuleClient['getEffectiveRunnerToolCapabilities']>
      >['capabilities']
    | null;
  reportedAt?: 'fresh' | 'stale' | 'missing';
}): void {
  setRunnerToolCapabilities(params.runnerSessionId, {
    capabilities: params.toolCapabilities === null ? {harnesses: {}} : params.toolCapabilities,
    reportFresh: params.reportedAt !== 'missing' && params.reportedAt !== 'stale',
  });
}

function annotationsFor(jobExecutionId: string): Array<{context: string; body: string}> {
  return Array.from(annotationBodiesByExecution.get(jobExecutionId) ?? [], ([context, body]) => ({
    context,
    body,
  }));
}

describe('warnAgentToolCapabilityMismatchOnDispatch', () => {
  it('writes a warning when the matched runner advertised a set without requested tools', async () => {
    const identity = lease();
    const step = agentStep({jobExecutionId: identity.jobExecutionId});
    setRunnerSessionCapabilities({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: {harnesses: {pi: {tools: ['read']}}},
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.context).toBe(`agent-tool-capability:${step.id}`);
    expect(rows[0]?.body).toContain('advertised a `pi` tool set without: `web_search`');
    expect(rows[0]?.body).toContain('Execution is continuing');
  });

  it('writes unknown wording when capabilities are missing', async () => {
    const identity = lease();
    const step = agentStep({jobExecutionId: identity.jobExecutionId});
    setRunnerSessionCapabilities({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: null,
      reportedAt: 'missing',
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows[0]?.body).toContain('reported no or stale tool capabilities');
    expect(rows[0]?.body).toContain('`read`, `web_search`');
  });

  it('writes missing-harness wording when fresh capabilities omit the harness', async () => {
    const identity = lease();
    const step = agentStep({jobExecutionId: identity.jobExecutionId});
    setRunnerSessionCapabilities({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: {harnesses: {claude: {tools: ['read', 'web_search']}}},
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows[0]?.body).toContain('did not advertise a `pi` tool set');
    expect(rows[0]?.body).not.toContain('reported no or stale tool capabilities');
  });

  it('uses Markdown-safe code spans for requested tool names', async () => {
    const identity = lease();
    const step = agentStep({
      jobExecutionId: identity.jobExecutionId,
      config: {
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        tools: ['read', 'we`ird'],
        prompt: 'Fix it.',
      },
    });
    setRunnerSessionCapabilities({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: {harnesses: {pi: {tools: ['read']}}},
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows[0]?.body).toContain('``we`ird``');
  });

  it('removes an existing warning when a later dispatch has all requested tools', async () => {
    const identity = lease();
    const step = agentStep({jobExecutionId: identity.jobExecutionId});
    setRunnerSessionCapabilities({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: {harnesses: {pi: {tools: ['read']}}},
    });
    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});
    setRunnerToolCapabilities(identity.runnerSessionId, {
      capabilities: {harnesses: {pi: {tools: ['read', 'web_search']}}},
      reportFresh: true,
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows).toEqual([]);
  });

  it('does nothing for agent steps without requested tools', async () => {
    const identity = lease();
    const step = agentStep({
      jobExecutionId: identity.jobExecutionId,
      config: {
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        prompt: 'Fix it.',
      },
    });
    setRunnerSessionCapabilities({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: null,
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    expect(await annotationsFor(identity.jobExecutionId)).toEqual([]);
  });

  it('does nothing for non-agent steps', async () => {
    const identity = lease();
    const step = agentStep({
      jobExecutionId: identity.jobExecutionId,
      type: 'run',
      config: {run: 'echo ok'},
    });
    setRunnerSessionCapabilities({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: null,
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    expect(await annotationsFor(identity.jobExecutionId)).toEqual([]);
  });

  it('caps long tool lists in the warning body', async () => {
    const identity = lease();
    const tools = Array.from({length: 12}, (_, index) => `tool_${index}`);
    const step = agentStep({
      jobExecutionId: identity.jobExecutionId,
      config: {
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        tools,
        prompt: 'Fix it.',
      },
    });
    setRunnerSessionCapabilities({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: {harnesses: {pi: {tools: []}}},
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows[0]?.body).toContain('...and 2 more');
    expect(rows[0]?.body).not.toContain('tool_10');
  });
});
