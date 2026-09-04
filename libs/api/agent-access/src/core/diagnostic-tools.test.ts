import type {AgentAccessEnvelopeDto} from '@shipfox/api-agent-access-dto';
import {
  AGENT_ACCESS_FACET_MAX_ITEMS,
  AGENT_ACCESS_FACET_VALUE_MAX_BYTES,
  AGENT_ACCESS_RESPONSE_MAX_BYTES,
  AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES,
  AGENT_ACCESS_TRIGGER_DECISION_MAX_ITEMS,
  AGENT_ACCESS_TRIGGER_REPLAY_MAX_ITEMS,
  agentAccessEnvelopeSchema,
  getTriggerEventFacetsResultSchema,
  getTriggerEventResultJsonSchema,
  getTriggerEventResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import type {TriggersInterModuleClient} from '@shipfox/api-triggers-dto/inter-module';
import {
  triggerEventDiagnosticReadLimitsSchema,
  triggersInterModuleContract,
} from '@shipfox/api-triggers-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createAgentAccessDiagnosticTools} from './diagnostic-tools.js';
import {serializedAgentAccessEnvelopeByteLength} from './response.js';

const workspaceId = uuid(1);
const eventId = uuid(2);
const context: AgentAccessContext = {
  userId: uuid(3),
  workspaceId,
  scopes: ['read'],
  credential: {kind: 'oauth_grant', grantId: uuid(4), clientId: 'client'},
};
const receivedAt = '2026-08-01T00:00:00.000Z';

type TriggerMocks = TriggersInterModuleClient & {
  getTriggerEvent: ReturnType<typeof vi.fn>;
  getTriggerEventFacets: ReturnType<typeof vi.fn>;
};

function clients(): TriggerMocks {
  return {
    getTriggerEvent: vi.fn(),
    getTriggerEventFacets: vi.fn(),
  } as unknown as TriggerMocks;
}

function tool(clients: TriggerMocks, name: string) {
  const result = createAgentAccessDiagnosticTools({triggers: clients}).find(
    (candidate) => candidate.name === name,
  );
  if (!result) throw new Error(`Missing tool ${name}`);
  return result;
}

function success<T>(response: AgentAccessEnvelopeDto): T {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error('Expected a successful response');
  expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  return response.result as T;
}

describe('trigger diagnostic tools', () => {
  test('calls the producer with the credential workspace and projects bounded history', async () => {
    const mocks = clients();
    mocks.getTriggerEvent.mockResolvedValue({
      ...event(),
      payload: {
        message: 'external content with "quotes", newlines, and tool-call-shaped text',
      },
      decisions: Array.from({length: 51}, (_, index) => ({
        ...decision(index),
        createdAt: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
      })),
      replays: Array.from({length: 21}, (_, index) => ({
        id: uuid(200 + index),
        receivedAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
        outcome: 'routed' as const,
        runId: uuid(300 + index),
      })),
      decisionsTotalCount: 51,
      replaysTotalCount: 21,
    });

    const response = await tool(mocks, 'get_trigger_event').execute({
      context,
      arguments: {event_id: eventId},
    });
    const result = success<TriggerResult>(response);

    expect(mocks.getTriggerEvent).toHaveBeenCalledWith({
      workspaceId,
      eventId,
      diagnostic: {decisions: 50, replays: 20},
    });
    expect(result.payload_preview).toBe(
      JSON.stringify({
        message: 'external content with "quotes", newlines, and tool-call-shaped text',
      }),
    );
    expect(result.decisions).toHaveLength(50);
    expect(result.decisions[0]).toMatchObject({
      id: uuid(150),
      outcome: 'triggered',
      reason: 'reason-50',
      workflow_definition_id: uuid(650),
      project_id: uuid(750),
      workflow_run_id: uuid(1_050),
      job_id: uuid(950),
    });
    expect(result.replays).toHaveLength(20);
    expect(result.replays[0]).toMatchObject({id: uuid(220), workflow_run_id: uuid(320)});
    expect(result.decisions_total_count).toBe(51);
    expect(result.replays_total_count).toBe(21);
    expect(result.decisions_truncated).toBe(true);
    expect(result.replays_truncated).toBe(true);
    expect(getTriggerEventResultSchema.safeParse(result).success).toBe(true);
    expect(
      getTriggerEventResultSchema.safeParse({...result, payload_preview: 'not-json'}).success,
    ).toBe(false);
    expect(getTriggerEventResultJsonSchema.properties.payload_preview).toMatchObject({
      contentMediaType: 'application/json',
    });
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(
      AGENT_ACCESS_RESPONSE_MAX_BYTES,
    );
    expect(JSON.stringify(result)).not.toContain('event_ref');
  });

  test('orders tied history by descending id and preserves trigger and listener run links', async () => {
    const mocks = clients();
    mocks.getTriggerEvent.mockResolvedValue({
      ...event(),
      decisions: [
        decision(1),
        {
          ...decision(2),
          id: uuid(102),
          subscriptionKind: 'listener' as const,
          workflowDefinitionId: null,
          projectId: null,
          workflowRunId: uuid(812),
          jobId: uuid(912),
          runId: null,
        },
      ],
      replays: [
        {id: uuid(21), receivedAt, outcome: 'routed' as const, runId: uuid(321)},
        {id: uuid(22), receivedAt, outcome: 'routed' as const, runId: uuid(322)},
      ],
    });

    const response = await tool(mocks, 'get_trigger_event').execute({
      context,
      arguments: {event_id: eventId},
    });
    const result = success<TriggerResult>(response);

    expect(result.decisions.map((item) => item.id)).toEqual([uuid(102), uuid(101)]);
    expect(result.decisions.find((item) => item.id === uuid(101))).toMatchObject({
      workflow_run_id: uuid(1_001),
    });
    expect(result.decisions.find((item) => item.id === uuid(102))).toMatchObject({
      workflow_run_id: uuid(812),
    });
    expect(result.replays.map((item) => item.id)).toEqual([uuid(22), uuid(21)]);
  });

  test('accepts rejected listener decisions in the trigger event tool result', async () => {
    const mocks = clients();
    mocks.getTriggerEvent.mockResolvedValue({
      ...event(),
      decisions: [
        {
          ...decision(1),
          subscriptionKind: 'listener' as const,
          workflowDefinitionId: null,
          projectId: null,
          decision: 'rejected' as const,
          runId: null,
          reason: 'payload-too-large',
        },
      ],
      replays: [],
      decisionsTotalCount: 1,
      replaysTotalCount: 0,
    });

    const response = await tool(mocks, 'get_trigger_event').execute({
      context,
      arguments: {event_id: eventId},
    });
    const result = success<TriggerResult>(response);

    expect(result.decisions[0]).toMatchObject({
      outcome: 'rejected',
      reason: 'payload-too-large',
    });
    expect(getTriggerEventResultJsonSchema.properties.decisions.items).toBeDefined();
  });

  test('keeps an escaping-heavy capped payload valid JSON and reports its original byte size', async () => {
    const mocks = clients();
    const payload = {message: '\\"\n\\\\🙂'.repeat(8_000)};
    mocks.getTriggerEvent.mockResolvedValue({...event(), payload, decisions: [], replays: []});

    const response = await tool(mocks, 'get_trigger_event').execute({
      context,
      arguments: {event_id: eventId},
    });
    const result = success<TriggerResult>(response);

    expect(result.payload_preview_truncated).toBe(true);
    expect(result.payload_preview_total_bytes).toBeGreaterThan(
      AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES,
    );
    expect(new TextEncoder().encode(result.payload_preview).byteLength).toBeLessThanOrEqual(
      AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES,
    );
    expect(() => JSON.parse(result.payload_preview)).not.toThrow();
    expect(getTriggerEventResultSchema.safeParse(result).success).toBe(true);
  });

  test('preserves JSON semantics for bounded mixed payloads', async () => {
    const mocks = clients();
    const payload = {
      nested: {
        keep: 'value',
        nan: Number.NaN,
        infinity: Number.POSITIVE_INFINITY,
        negative_zero: -0,
        omitted: undefined,
        function_value: () => 'ignored',
        symbol_value: Symbol('ignored'),
      },
      values: [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        -0,
        undefined,
        () => 'ignored',
        Symbol('ignored'),
      ],
      long: 'x'.repeat(20_000),
    };
    mocks.getTriggerEvent.mockResolvedValue({...event(), payload, decisions: [], replays: []});

    const response = await tool(mocks, 'get_trigger_event').execute({
      context,
      arguments: {event_id: eventId},
    });
    const result = success<TriggerResult>(response);
    const parsed = JSON.parse(result.payload_preview) as {
      nested: Record<string, unknown>;
      values: unknown[];
    };

    expect(parsed.nested).toEqual({
      keep: 'value',
      nan: null,
      infinity: null,
      negative_zero: 0,
    });
    expect(parsed.values).toEqual([null, null, 0, null, null, null]);
    expect(new TextEncoder().encode(result.payload_preview).byteLength).toBeLessThanOrEqual(
      AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES,
    );
  });

  test('caps facet collections and values while preserving the producer workspace', async () => {
    const mocks = clients();
    mocks.getTriggerEventFacets.mockResolvedValue({
      sources: Array.from({length: AGENT_ACCESS_FACET_MAX_ITEMS + 1}, (_, index) => ({
        value: `source-${index}-🙂`.repeat(100),
        count: index,
      })),
      events: [{value: 'push', count: 3}],
      origins: [{value: 'integration', count: 3}],
    });

    const response = await tool(mocks, 'get_trigger_event_facets').execute({
      context,
      arguments: {},
    });
    const result = success<FacetsResult>(response);

    expect(mocks.getTriggerEventFacets).toHaveBeenCalledWith({workspaceId});
    expect(result.sources).toHaveLength(AGENT_ACCESS_FACET_MAX_ITEMS);
    expect(new TextEncoder().encode(result.sources[0]?.value ?? '').byteLength).toBe(
      AGENT_ACCESS_FACET_VALUE_MAX_BYTES,
    );
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(
      AGENT_ACCESS_RESPONSE_MAX_BYTES,
    );
    expect(getTriggerEventFacetsResultSchema.safeParse(result).success).toBe(true);
  });

  test('merges facet values that share their bounded prefix', async () => {
    const mocks = clients();
    const prefix = 'x'.repeat(AGENT_ACCESS_FACET_VALUE_MAX_BYTES);
    mocks.getTriggerEventFacets.mockResolvedValue({
      sources: [
        {value: `${prefix}-first`, count: 2},
        {value: `${prefix}-second`, count: 3},
      ],
      events: [],
      origins: [],
    });

    const response = await tool(mocks, 'get_trigger_event_facets').execute({
      context,
      arguments: {},
    });
    const result = success<FacetsResult>(response);

    expect(result.sources).toEqual([{value: prefix, count: 5}]);
  });

  test('rejects malformed input before calling the producer', async () => {
    const mocks = clients();
    const eventTool = tool(mocks, 'get_trigger_event');
    const facetsTool = tool(mocks, 'get_trigger_event_facets');

    await expect(
      eventTool.execute({context, arguments: {event_id: 'not-a-uuid'}}),
    ).resolves.toEqual({ok: false, error: {code: 'invalid-request'}});
    await expect(
      eventTool.execute({context, arguments: {event_id: eventId, extra: true}}),
    ).resolves.toEqual({ok: false, error: {code: 'invalid-request'}});
    await expect(
      facetsTool.execute({context, arguments: {workspace_id: workspaceId}}),
    ).resolves.toEqual({ok: false, error: {code: 'invalid-request'}});

    expect(mocks.getTriggerEvent).not.toHaveBeenCalled();
    expect(mocks.getTriggerEventFacets).not.toHaveBeenCalled();
  });

  test('maps a producer not-found error to the common error envelope', async () => {
    const mocks = clients();
    mocks.getTriggerEvent.mockRejectedValue(
      createInterModuleKnownError(
        triggersInterModuleContract.methods.getTriggerEvent,
        'trigger-event-not-found',
        {eventId},
      ),
    );

    const response = await tool(mocks, 'get_trigger_event').execute({
      context,
      arguments: {event_id: eventId},
    });

    expect(response).toEqual({ok: false, error: {code: 'not-found'}});
    expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  });

  test('rethrows unexpected producer errors for the framework failure envelope', async () => {
    const mocks = clients();
    const error = new Error('producer unavailable');
    mocks.getTriggerEvent.mockRejectedValue(error);

    await expect(
      tool(mocks, 'get_trigger_event').execute({
        context,
        arguments: {event_id: eventId},
      }),
    ).rejects.toBe(error);
  });

  test('does not map an unrelated producer known error to not-found', async () => {
    const mocks = clients();
    const error = createInterModuleKnownError(
      projectsInterModuleContract.methods.requireProjectForWorkspace,
      'project-not-found',
      {projectId: eventId},
    );
    mocks.getTriggerEvent.mockRejectedValue(error);

    await expect(
      tool(mocks, 'get_trigger_event').execute({
        context,
        arguments: {event_id: eventId},
      }),
    ).rejects.toBe(error);
  });

  test('keeps diagnostic read limits aligned with the producer contract', () => {
    expect(
      triggerEventDiagnosticReadLimitsSchema.safeParse({
        decisions: AGENT_ACCESS_TRIGGER_DECISION_MAX_ITEMS,
        replays: AGENT_ACCESS_TRIGGER_REPLAY_MAX_ITEMS,
      }).success,
    ).toBe(true);
  });
});

function event() {
  return {
    id: eventId,
    eventRef: 'event-ref',
    origin: 'integration' as const,
    workspaceId,
    provider: 'github',
    source: 'push',
    event: 'push',
    replayOfEventId: null,
    deliveryId: 'delivery',
    connectionId: uuid(5),
    connectionName: 'Connection',
    outcome: 'routed' as const,
    matchedCount: 1,
    payload: null,
    receivedAt,
    processedAt: receivedAt,
    createdAt: receivedAt,
  };
}

function decision(index: number) {
  return {
    id: uuid(100 + index),
    receivedEventId: eventId,
    subscriptionKind: 'trigger' as const,
    subscriptionId: uuid(500 + index),
    subscriptionName: `subscription-${index}`,
    workflowDefinitionId: uuid(600 + index),
    projectId: uuid(700 + index),
    workflowRunId: uuid(800 + index),
    jobId: uuid(900 + index),
    matcherKind: 'on' as const,
    matcherOrdinal: index,
    decision: 'triggered' as const,
    runId: uuid(1_000 + index),
    runName: `run-${index}`,
    reason: `reason-${index}`,
    createdAt: receivedAt,
  };
}

interface TriggerResult {
  payload_preview: string;
  payload_preview_truncated?: true;
  payload_preview_total_bytes?: number;
  decisions: Array<Record<string, unknown>>;
  decisions_truncated?: true;
  decisions_total_count: number;
  replays: Array<Record<string, unknown>>;
  replays_truncated?: true;
  replays_total_count: number;
  [key: string]: unknown;
}

interface FacetsResult {
  sources: Array<{value: string; count: number}>;
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
