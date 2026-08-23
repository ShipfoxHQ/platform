import {and, eq, notInArray} from 'drizzle-orm';
import type {
  JobListenerMatcherKind,
  JobListenerSubscription,
} from '#core/entities/job-listener-subscription.js';
import {db} from './db.js';
import {
  jobListenerSubscriptions,
  toJobListenerSubscription,
} from './schema/job-listener-subscriptions.js';
import {normalizeSubscriptionEvent, subscriptionEventCondition} from './subscription-event.js';

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export interface ListenerMatcher {
  source: string;
  event?: string | undefined;
  inputs?: Readonly<Record<string, unknown>> | undefined;
  filter?: string | undefined;
  filter_snapshot?: Readonly<Record<string, unknown>> | undefined;
  filter_output_types?: Readonly<Record<string, unknown>> | undefined;
}

export interface ProjectJobListenerSubscriptionsParams {
  workspaceId: string;
  workflowRunId: string;
  jobId: string;
  on: readonly ListenerMatcher[] | null;
  until: readonly ListenerMatcher[] | null;
}

export async function projectJobListenerSubscriptions(
  params: ProjectJobListenerSubscriptionsParams,
): Promise<void> {
  await db().transaction(async (tx) => {
    await pruneStaleMatchers(tx, params.jobId, 'on', params.on ?? []);
    await pruneStaleMatchers(tx, params.jobId, 'until', params.until ?? []);

    for (const [kind, matchers] of [
      ['on', params.on ?? []],
      ['until', params.until ?? []],
    ] as const) {
      for (const [matcherOrdinal, matcher] of matchers.entries()) {
        const config: Record<string, unknown> = {};
        if (matcher.inputs !== undefined) config.inputs = matcher.inputs;
        if (matcher.filter !== undefined) config.filter = matcher.filter;
        if (matcher.filter_snapshot !== undefined) config.filter_snapshot = matcher.filter_snapshot;
        if (matcher.filter_output_types !== undefined) {
          config.filter_output_types = matcher.filter_output_types;
        }

        await tx
          .insert(jobListenerSubscriptions)
          .values({
            workspaceId: params.workspaceId,
            workflowRunId: params.workflowRunId,
            jobId: params.jobId,
            kind,
            matcherOrdinal,
            source: matcher.source,
            event: normalizeSubscriptionEvent({source: matcher.source, event: matcher.event}),
            config,
          })
          .onConflictDoUpdate({
            target: [
              jobListenerSubscriptions.jobId,
              jobListenerSubscriptions.kind,
              jobListenerSubscriptions.matcherOrdinal,
            ],
            set: {
              workspaceId: params.workspaceId,
              workflowRunId: params.workflowRunId,
              source: matcher.source,
              event: normalizeSubscriptionEvent({source: matcher.source, event: matcher.event}),
              config,
            },
          });
      }
    }
  });
}

async function pruneStaleMatchers(
  tx: Tx,
  jobId: string,
  kind: JobListenerMatcherKind,
  matchers: readonly ListenerMatcher[],
): Promise<void> {
  const base = and(
    eq(jobListenerSubscriptions.jobId, jobId),
    eq(jobListenerSubscriptions.kind, kind),
  );

  if (matchers.length === 0) {
    await tx.delete(jobListenerSubscriptions).where(base);
    return;
  }

  await tx.delete(jobListenerSubscriptions).where(
    and(
      base,
      notInArray(
        jobListenerSubscriptions.matcherOrdinal,
        matchers.map((_matcher, index) => index),
      ),
    ),
  );
}

export async function removeJobListenerSubscriptionsForJob(jobId: string): Promise<number> {
  const rows = await db()
    .delete(jobListenerSubscriptions)
    .where(eq(jobListenerSubscriptions.jobId, jobId))
    .returning({id: jobListenerSubscriptions.id});
  return rows.length;
}

export interface FindMatchingJobListenerSubscriptionsParams {
  workspaceId: string;
  source: string;
  event: string;
}

export async function findMatchingJobListenerSubscriptions(
  params: FindMatchingJobListenerSubscriptionsParams,
): Promise<JobListenerSubscription[]> {
  const rows = await db()
    .select()
    .from(jobListenerSubscriptions)
    .where(
      and(
        eq(jobListenerSubscriptions.workspaceId, params.workspaceId),
        eq(jobListenerSubscriptions.source, params.source),
        subscriptionEventCondition(jobListenerSubscriptions.event, params.event),
      ),
    );
  return rows.map(toJobListenerSubscription);
}

export async function hasJobListenerSubscriptions(jobId: string): Promise<boolean> {
  const [subscription] = await db()
    .select({id: jobListenerSubscriptions.id})
    .from(jobListenerSubscriptions)
    .where(eq(jobListenerSubscriptions.jobId, jobId))
    .limit(1);
  return subscription !== undefined;
}
