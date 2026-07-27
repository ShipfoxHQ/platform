/** A provider or control-plane failure whose recovery can be proved independently. */
export type HealthFacet =
  | 'startup_reconciliation'
  | 'provider_observation'
  | 'provider_termination'
  | 'poll_demand'
  | 'authentication'
  | 'runner_capacity';
export type HealthImpact = 'capacity' | 'cleanup' | 'control_plane';

export interface HealthState {
  active: ReadonlyMap<HealthFacet, HealthFailure>;
  incident?: HealthIncident | undefined;
  hasEverBeenReady: boolean;
}

export interface HealthFailure {
  readonly cause: string;
  readonly impact: HealthImpact;
  readonly failureCount?: number | undefined;
}

export interface HealthIncident {
  /** Stable, sorted representation of every active facet, cause, and impact. */
  readonly fingerprint: string;
  readonly startedAt: Date;
  readonly attempts: number;
  readonly suppressed: number;
}

export type HealthEvent =
  | {
      readonly type: 'facet_failed';
      readonly facet: HealthFacet;
      readonly cause: string;
      readonly impact: HealthImpact;
      readonly failureCount?: number | undefined;
      readonly at: Date;
    }
  | {
      readonly type: 'facet_recovered';
      readonly facet: HealthFacet;
      readonly at: Date;
    }
  | {readonly type: 'ready_confirmed'; readonly at: Date};

export interface HealthLog {
  readonly level: 'error' | 'warn' | 'info';
  readonly event:
    | 'provisioner.degraded'
    | 'provisioner.degraded_reminder'
    | 'provisioner.partially_recovered'
    | 'provisioner.recovered'
    | 'provisioner.ready';
  readonly facet?: HealthFacet | undefined;
  readonly cause?: string | undefined;
  readonly changed?: boolean | undefined;
  readonly recoveredFacet?: HealthFacet | undefined;
  readonly remainingFacetCount?: number | undefined;
  readonly impact?: HealthImpact | undefined;
  readonly attempts?: number | undefined;
  readonly suppressed?: number | undefined;
  readonly outageDurationMs?: number | undefined;
}

export interface HealthDerivedState {
  readonly capacityDegraded: boolean;
  readonly shouldBackOff: boolean;
  readonly ready: boolean;
}

export interface HealthReduction {
  readonly state: HealthState;
  readonly derived: HealthDerivedState;
  readonly logs: readonly HealthLog[];
}

const REMINDER_EVERY_SUPPRESSED = 5;

export function createHealthState(): HealthState {
  return {active: new Map(), hasEverBeenReady: false};
}

/**
 * Apply one lifecycle fact to health. The reducer has no logging or timer side effects;
 * callers decide how to emit the returned log records. Derived control-loop decisions
 * are calculated from the active facets on every reduction instead of being cached.
 */
export function reduceHealth(state: HealthState, event: HealthEvent): HealthReduction {
  const active = new Map(state.active);
  let incident = state.incident;
  let hasEverBeenReady = state.hasEverBeenReady;
  const logs: HealthLog[] = [];

  if (event.type === 'facet_failed') {
    active.set(event.facet, {
      cause: event.cause,
      impact: event.impact,
      ...(event.failureCount !== undefined ? {failureCount: event.failureCount} : {}),
    });
    const fingerprint = activeFingerprint(active);
    if (!incident) {
      incident = {
        fingerprint,
        startedAt: event.at,
        attempts: 1,
        suppressed: 0,
      };
      logs.push({
        level: 'error',
        event: 'provisioner.degraded',
        facet: event.facet,
        cause: event.cause,
        impact: event.impact,
        attempts: incident.attempts,
        suppressed: incident.suppressed,
      });
    } else {
      const changed = incident.fingerprint !== fingerprint;
      incident = {
        ...incident,
        fingerprint,
        attempts: incident.attempts + 1,
        suppressed: incident.suppressed + (changed ? 0 : 1),
      };
      if (changed) {
        logs.push({
          level: 'error',
          event: 'provisioner.degraded',
          facet: event.facet,
          cause: event.cause,
          changed: true,
          impact: event.impact,
          attempts: incident.attempts,
          suppressed: incident.suppressed,
        });
      } else if (incident.suppressed > 0 && incident.suppressed % REMINDER_EVERY_SUPPRESSED === 0) {
        logs.push({
          level: 'warn',
          event: 'provisioner.degraded_reminder',
          facet: event.facet,
          cause: event.cause,
          impact: event.impact,
          attempts: incident.attempts,
          suppressed: incident.suppressed,
        });
      }
    }
  } else if (event.type === 'facet_recovered') {
    if (active.has(event.facet)) {
      active.delete(event.facet);
      if (active.size === 0 && incident) {
        logs.push({
          level: 'info',
          event: 'provisioner.recovered',
          attempts: incident.attempts,
          suppressed: incident.suppressed,
          outageDurationMs: Math.max(0, event.at.getTime() - incident.startedAt.getTime()),
        });
        incident = undefined;
      } else if (incident) {
        const fingerprint = activeFingerprint(active);
        const changed = incident.fingerprint !== fingerprint;
        incident = {...incident, fingerprint};
        if (changed) {
          logs.push({
            level: 'info',
            event: 'provisioner.partially_recovered',
            recoveredFacet: event.facet,
            remainingFacetCount: active.size,
            impact: currentImpact(active),
            attempts: incident.attempts,
            suppressed: incident.suppressed,
          });
        }
      }
    }
  } else if (event.type === 'ready_confirmed' && !hasEverBeenReady && readinessAvailable(active)) {
    hasEverBeenReady = true;
    logs.push({level: 'info', event: 'provisioner.ready'});
  }

  const nextState: HealthState = {
    active,
    ...(incident ? {incident} : {}),
    hasEverBeenReady,
  };
  return {state: nextState, derived: deriveHealth(nextState), logs};
}

export function deriveHealth(state: HealthState): HealthDerivedState {
  return derivedFor(state.active, state.hasEverBeenReady);
}

function activeFingerprint(active: ReadonlyMap<HealthFacet, HealthFailure>): string {
  return JSON.stringify(
    [...active.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([facet, failure]) => [facet, failure.cause, failure.impact]),
  );
}

function derivedFor(
  active: ReadonlyMap<HealthFacet, HealthFailure>,
  hasEverBeenReady: boolean,
): HealthDerivedState {
  const failures = [...active.values()];
  return {
    capacityDegraded: failures.some((failure) => failure.impact === 'capacity'),
    shouldBackOff: failures.some((failure) => failure.impact !== 'cleanup'),
    ready: hasEverBeenReady && failures.every((failure) => failure.impact === 'cleanup'),
  };
}

function readinessAvailable(active: ReadonlyMap<HealthFacet, HealthFailure>): boolean {
  return [...active.values()].every((failure) => failure.impact === 'cleanup');
}

function currentImpact(active: ReadonlyMap<HealthFacet, HealthFailure>): HealthImpact | undefined {
  if ([...active.values()].some((failure) => failure.impact === 'capacity')) return 'capacity';
  if ([...active.values()].some((failure) => failure.impact === 'control_plane')) {
    return 'control_plane';
  }
  return [...active.values()][0]?.impact;
}
