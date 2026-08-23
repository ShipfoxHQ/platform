import {eq, isNull, or} from 'drizzle-orm';
import type {PgColumn} from 'drizzle-orm/pg-core';

export function normalizeSubscriptionEvent(params: {
  source: string;
  event: string | null | undefined;
}): string | null {
  const normalizedEvent = params.event?.trim();
  if (!normalizedEvent && (params.source === 'manual' || params.source === 'cron')) {
    throw new Error(`A ${params.source} subscription requires an event`);
  }
  return normalizedEvent || null;
}

export function subscriptionEventCondition(column: PgColumn, event: string) {
  return or(eq(column, event), isNull(column));
}
