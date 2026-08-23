import {eq, isNull, or} from 'drizzle-orm';
import type {PgColumn} from 'drizzle-orm/pg-core';

export function normalizeSubscriptionEvent(params: {
  source: string;
  event: string | null | undefined;
}): string | null {
  if (params.event === undefined || params.event === null) {
    if (params.source === 'manual' || params.source === 'cron') {
      throw new Error(`A ${params.source} subscription requires an event`);
    }
    return null;
  }

  const normalizedEvent = params.event.trim();
  if (normalizedEvent === '') {
    throw new Error(`A ${params.source} subscription event cannot be blank`);
  }
  return normalizedEvent;
}

export function subscriptionEventCondition(column: PgColumn, event: string) {
  return or(eq(column, event), isNull(column));
}
