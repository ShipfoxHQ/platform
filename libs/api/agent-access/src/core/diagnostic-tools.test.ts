import type {AgentAccessEnvelopeDto} from '@shipfox/api-agent-access-dto';
import {
  agentAccessEnvelopeSchema,
  getTriggerEventFacetsResultSchema,
  getTriggerEventResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import type {TriggersInterModuleClient} from '@shipfox/api-triggers-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
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
      workflow_run_id: uuid(850),
      job_id: uuid(950),
    });
    expect(result.replays).toHaveLength(20);
    expect(result.replays[0]).toMatchObject({id: uuid(220), workflow_run_id: uuid(320)});
    expect(result.decisions_total_count).toBe(51);
    expect(result.replays_total_count).toBe(21);
    expect(result.decisions_truncated).toBe(true);
    expect(result.replays_truncated).toBe(true);
    expect(getTriggerEventResultSchema.safeParse(result).success).toBe(true);
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(128 * 1024);
    expect(JSON.stringify(result)).not.toContain('event_ref');
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
    expect(result.payload_preview_total_bytes).toBeGreaterThan(16 * 1024);
    expect(new TextEncoder().encode(result.payload_preview).byteLength).toBeLessThanOrEqual(
      16 * 1024,
    );
    expect(() => JSON.parse(result.payload_preview)).not.toThrow();
    expect(getTriggerEventResultSchema.safeParse(result).success).toBe(true);
  });

  test('caps facet collections and values while preserving the producer workspace', async () => {
    const mocks = clients();
    mocks.getTriggerEventFacets.mockResolvedValue({
      sources: Array.from({length: 51}, (_, index) => ({
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
    expect(result.sources).toHaveLength(50);
    expect(new TextEncoder().encode(result.sources[0]?.value ?? '').byteLength).toBe(256);
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(128 * 1024);
    expect(getTriggerEventFacetsResultSchema.safeParse(result).success).toBe(true);
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
