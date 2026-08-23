import {paginateTimestampIdRows, timestampIdCursorWhere} from '@shipfox/node-drizzle';
import {and, asc, count, desc, eq, gte, inArray, isNotNull, lte, type SQL} from 'drizzle-orm';
import type {PgColumn} from 'drizzle-orm/pg-core';
import type {TriggerDecision} from '#core/entities/decision.js';
import type {
  TriggerEventOrigin,
  TriggerEventOutcome,
  TriggerReceivedEvent,
  TriggerReceivedEventSummary,
} from '#core/entities/received-event.js';
import {db} from './db.js';
import {toTriggerDecision, triggersDecisions} from './schema/decisions.js';
import {
  toTriggerReceivedEvent,
  toTriggerReceivedEventSummary,
  triggerReceivedEventSummaryColumns,
  triggersReceivedEvents,
} from './schema/received-events.js';

export interface TriggerEventCursor {
  receivedAt: Date;
  id: string;
}

export interface TriggerEventListFilters {
  source?: string[] | undefined;
  event?: string[] | undefined;
  origins?: TriggerEventOrigin[] | undefined;
  outcomes?: TriggerEventOutcome[] | undefined;
  replayable?: boolean | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface ListTriggerEventsParams {
  workspaceId: string;
  limit: number;
  cursor?: TriggerEventCursor | undefined;
  filters?: TriggerEventListFilters | undefined;
}

export interface ListTriggerEventsResult {
  events: TriggerReceivedEventSummary[];
  nextCursor: TriggerEventCursor | null;
}

function listConditions(params: ListTriggerEventsParams): SQL[] {
  const {workspaceId, cursor, filters} = params;
  const conditions: SQL[] = [eq(triggersReceivedEvents.workspaceId, workspaceId)];
  const cursorCondition = timestampIdCursorWhere({
    timestampColumn: triggersReceivedEvents.receivedAt,
    idColumn: triggersReceivedEvents.id,
    cursor: cursor ? {createdAt: cursor.receivedAt, id: cursor.id} : undefined,
  });
  if (cursorCondition) conditions.push(cursorCondition);
  if (filters?.source?.length)
    conditions.push(inArray(triggersReceivedEvents.source, filters.source));
  if (filters?.event?.length) conditions.push(inArray(triggersReceivedEvents.event, filters.event));
  if (filters?.origins?.length)
    conditions.push(inArray(triggersReceivedEvents.origin, filters.origins));
  if (filters?.outcomes?.length)
    conditions.push(inArray(triggersReceivedEvents.outcome, filters.outcomes));
  // `replayable` is the picker's convenience filter: integration events with a
  // stored payload are the only ones a dev run can replay.
  if (filters?.replayable) {
    conditions.push(eq(triggersReceivedEvents.origin, 'integration'));
    conditions.push(isNotNull(triggersReceivedEvents.payload));
  }
  if (filters?.from) conditions.push(gte(triggersReceivedEvents.receivedAt, filters.from));
  if (filters?.to) conditions.push(lte(triggersReceivedEvents.receivedAt, filters.to));
  return conditions;
}

export async function listTriggerEvents(
  params: ListTriggerEventsParams,
): Promise<ListTriggerEventsResult> {
  const rows = await db()
    .select(triggerReceivedEventSummaryColumns)
    .from(triggersReceivedEvents)
    .where(and(...listConditions(params)))
    .orderBy(desc(triggersReceivedEvents.receivedAt), desc(triggersReceivedEvents.id))
    .limit(params.limit + 1);

  const page = paginateTimestampIdRows({rows, limit: params.limit, timestampKey: 'receivedAt'});

  return {
    events: page.pageRows.map(toTriggerReceivedEventSummary),
    nextCursor: page.nextCursor
      ? {receivedAt: page.nextCursor.createdAt, id: page.nextCursor.id}
      : null,
  };
}

export async function getTriggerEventById(id: string): Promise<TriggerReceivedEvent | undefined> {
  const [row] = await db()
    .select()
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.id, id))
    .limit(1);
  return row ? toTriggerReceivedEvent(row) : undefined;
}

export interface TriggerEventFacet {
  value: string;
  count: number;
}

export interface ListTriggerEventFacetsResult {
  sources: TriggerEventFacet[];
  events: TriggerEventFacet[];
  origins: TriggerEventFacet[];
}

// Distinct filter values for a workspace, capped so one noisy integration can't flood
// the dropdown. Workspace-unfiltered by design: a stable option list, not one that
// shifts as the other filters change. The (workspace_id, source) / (workspace_id, event)
// indexes back the group-by. Ties break on the value so the order is deterministic.
const FACET_LIMIT = 50;

async function listFacet(workspaceId: string, column: PgColumn): Promise<TriggerEventFacet[]> {
  const rows = await db()
    .select({value: column, count: count()})
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.workspaceId, workspaceId))
    .groupBy(column)
    .orderBy(desc(count()), asc(column))
    .limit(FACET_LIMIT);
  return rows.map((row) => ({value: row.value as string, count: Number(row.count)}));
}

export async function listTriggerEventFacets(params: {
  workspaceId: string;
}): Promise<ListTriggerEventFacetsResult> {
  const [sources, events, origins] = await Promise.all([
    listFacet(params.workspaceId, triggersReceivedEvents.source),
    listFacet(params.workspaceId, triggersReceivedEvents.event),
    listFacet(params.workspaceId, triggersReceivedEvents.origin),
  ]);
  return {sources, events, origins};
}

// A dev journal entry that replayed a given source event. `run_id` comes from
// the entry's single `dev` decision and is null when the replay was refused
// before a run was created (filter false or filter evaluation error).
export interface TriggerEventReplay {
  id: string;
  receivedAt: Date;
  outcome: TriggerEventOutcome;
  runId: string | null;
}

// The workspace predicate mirrors the route's workspace gate: replay links are
// deliberately FK-less, so the back-direction lookup must not surface a replay
// row that another workspace's writer pointed at this event id.
export async function listReplaysOfTriggerEvent(
  eventId: string,
  workspaceId: string,
): Promise<TriggerEventReplay[]> {
  const rows = await db()
    .select({
      id: triggersReceivedEvents.id,
      receivedAt: triggersReceivedEvents.receivedAt,
      outcome: triggersReceivedEvents.outcome,
      runId: triggersDecisions.runId,
    })
    .from(triggersReceivedEvents)
    .leftJoin(
      triggersDecisions,
      and(
        eq(triggersDecisions.receivedEventId, triggersReceivedEvents.id),
        eq(triggersDecisions.subscriptionKind, 'dev'),
      ),
    )
    .where(
      and(
        eq(triggersReceivedEvents.replayOfEventId, eventId),
        eq(triggersReceivedEvents.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(triggersReceivedEvents.receivedAt), desc(triggersReceivedEvents.id));

  return rows.map((row) => ({
    id: row.id,
    receivedAt: row.receivedAt,
    outcome: row.outcome,
    runId: row.runId,
  }));
}

// `received_event_id` is a globally-unique uuid, so the parent-event lookup is the
// workspace gate; the decision query needs no separate workspace predicate.
export async function listDecisionsByReceivedEventId(
  receivedEventId: string,
): Promise<TriggerDecision[]> {
  const rows = await db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, receivedEventId))
    .orderBy(asc(triggersDecisions.createdAt), asc(triggersDecisions.id));
  return rows.map(toTriggerDecision);
}
