import {createHealthState, type HealthEvent, type HealthFacet, reduceHealth} from '#health.js';

const time = (seconds: number) => new Date(seconds * 1000);

describe('reduceHealth', () => {
  it.each([
    {
      name: 'observation repeats',
      events: repeatedFailureEvents('provider_observation', 'daemon unavailable', 'capacity'),
      expectedLogEvents: ['provisioner.degraded', 'provisioner.degraded_reminder'],
      expectedDerived: {capacityDegraded: true, shouldBackOff: true, ready: false},
    },
    {
      name: 'termination cleanup repeats without affecting capacity',
      events: repeatedFailureEvents('provider_termination', 'container cleanup failed', 'cleanup'),
      expectedLogEvents: ['provisioner.degraded', 'provisioner.degraded_reminder'],
      expectedDerived: {capacityDegraded: false, shouldBackOff: false, ready: false},
    },
  ])('keeps one stable episode for $name', ({events, expectedLogEvents, expectedDerived}) => {
    const result = reduceEvents(events);

    expect(result.logs.map((log) => log.event)).toEqual(expectedLogEvents);
    expect(result.derived).toEqual(expectedDerived);
    expect(result.state.incident).toMatchObject({attempts: 6, suppressed: 5});
  });

  it('keeps concurrent facets stable regardless of evaluation order', () => {
    const forward = reduceEvents([
      failure('provider_observation', 'daemon unavailable', 'capacity', 1),
      failure('provider_termination', 'cleanup unavailable', 'cleanup', 2),
    ]);
    const reverse = reduceEvents([
      failure('provider_termination', 'cleanup unavailable', 'cleanup', 1),
      failure('provider_observation', 'daemon unavailable', 'capacity', 2),
    ]);

    expect(Object.fromEntries(forward.state.active)).toEqual(
      Object.fromEntries(reverse.state.active),
    );
    expect(forward.state.incident?.fingerprint).toBe(reverse.state.incident?.fingerprint);
    expect(forward.derived).toEqual({capacityDegraded: true, shouldBackOff: true, ready: false});
    expect(reverse.derived).toEqual(forward.derived);
  });
  it('treats same-cause facets as distinct health transitions', () => {
    const result = reduceEvents([
      failure('provider_observation', 'daemon unavailable', 'capacity', 1),
      failure('provider_termination', 'daemon unavailable', 'cleanup', 2),
    ]);
    expect(result.logs.map((log) => log.event)).toEqual([
      'provisioner.degraded',
      'provisioner.degraded',
    ]);
    expect(result.logs.at(-1)).toMatchObject({
      facet: 'provider_termination',
      changed: true,
      impact: 'cleanup',
    });
  });
  it('reports a partial recovery as a changed active snapshot', () => {
    const result = reduceEvents([
      failure('provider_observation', 'daemon unavailable', 'capacity', 1),
      failure('provider_termination', 'cleanup unavailable', 'cleanup', 2),
      recovered('provider_observation', 3),
    ]);
    expect(result.logs.map((log) => log.event)).toEqual([
      'provisioner.degraded',
      'provisioner.degraded',
      'provisioner.partially_recovered',
    ]);
    expect(result.logs.at(-1)).toMatchObject({
      level: 'info',
      recoveredFacet: 'provider_observation',
      remainingFacetCount: 1,
      impact: 'cleanup',
    });
  });

  it('recovers once after the final facet clears and preserves incident counters', () => {
    const result = reduceEvents([
      failure('provider_observation', 'daemon unavailable', 'capacity', 1),
      failure('provider_termination', 'cleanup unavailable', 'cleanup', 2),
      recovered('provider_observation', 3),
      recovered('provider_termination', 4),
    ]);

    expect(result.logs.map((log) => log.event)).toEqual([
      'provisioner.degraded',
      'provisioner.degraded',
      'provisioner.partially_recovered',
      'provisioner.recovered',
    ]);
    expect(result.logs[2]).toMatchObject({
      level: 'info',
      recoveredFacet: 'provider_observation',
      remainingFacetCount: 1,
      impact: 'cleanup',
    });
    expect(result.logs.at(-1)).toMatchObject({attempts: 2, suppressed: 0});
    expect(result.state.active).toHaveLength(0);
    expect(result.state.incident).toBeUndefined();
    expect(result.derived).toEqual({capacityDegraded: false, shouldBackOff: false, ready: false});
  });

  it('does not let empty termination success recover observation failure', () => {
    const result = reduceEvents([
      failure('provider_observation', 'daemon unavailable', 'capacity', 1),
      recovered('provider_termination', 2),
    ]);

    expect(result.state.active.has('provider_observation')).toBe(true);
    expect(result.logs.map((log) => log.event)).toEqual(['provisioner.degraded']);
    expect(result.derived.shouldBackOff).toBe(true);
  });

  it('changes the active fingerprint when cleanup moves to another target', () => {
    const result = reduceEvents([
      failure('provider_termination', 'container-A', 'cleanup', 1),
      failure('provider_termination', 'container-B', 'cleanup', 2),
    ]);

    expect(result.state.active.get('provider_termination')?.cause).toBe('container-B');
    expect(result.logs.map((log) => log.event)).toEqual([
      'provisioner.degraded',
      'provisioner.degraded',
    ]);
    expect(result.logs.at(-1)).toMatchObject({changed: true, cause: 'container-B'});
    expect(result.state.incident?.attempts).toBe(2);
  });

  it('confirms readiness separately from recovery', () => {
    const result = reduceHealth(createHealthState(), {type: 'ready_confirmed', at: time(1)});

    expect(result.logs).toEqual([{level: 'info', event: 'provisioner.ready'}]);
    expect(result.derived.ready).toBe(true);
  });
  it('waits for healthy capacity before confirming the one-time readiness milestone', () => {
    const failed = reduceHealth(createHealthState(), {
      type: 'facet_failed',
      facet: 'runner_capacity',
      cause: 'launch failed',
      impact: 'capacity',
      at: time(1),
    });
    const blocked = reduceHealth(failed.state, {type: 'ready_confirmed', at: time(2)});
    const recovered = reduceHealth(blocked.state, {
      type: 'facet_recovered',
      facet: 'runner_capacity',
      at: time(3),
    });
    const confirmed = reduceHealth(recovered.state, {type: 'ready_confirmed', at: time(4)});
    const repeated = reduceHealth(confirmed.state, {type: 'ready_confirmed', at: time(5)});
    expect(blocked.logs).toEqual([]);
    expect(confirmed.logs).toEqual([{level: 'info', event: 'provisioner.ready'}]);
    expect(repeated.logs).toEqual([]);
    expect(repeated.state.hasEverBeenReady).toBe(true);
    expect(repeated.derived.ready).toBe(true);
  });
});

function reduceEvents(events: readonly HealthEvent[]) {
  let result = {
    state: createHealthState(),
    derived: {capacityDegraded: false, shouldBackOff: false, ready: false},
    logs: [] as readonly ReturnType<typeof reduceHealth>['logs'][number][],
  };
  for (const event of events) {
    const next = reduceHealth(result.state, event);
    result = {
      state: next.state,
      derived: next.derived,
      logs: [...result.logs, ...next.logs],
    };
  }
  return result;
}

function repeatedFailureEvents(
  facet: HealthFacet,
  cause: string,
  impact: 'capacity' | 'cleanup',
): HealthEvent[] {
  return Array.from({length: 6}, (_, index) => failure(facet, cause, impact, index + 1));
}

function failure(
  facet: HealthFacet,
  cause: string,
  impact: 'capacity' | 'cleanup',
  seconds: number,
): HealthEvent {
  return {type: 'facet_failed', facet, cause, impact, at: time(seconds)};
}

function recovered(facet: HealthFacet, seconds: number): HealthEvent {
  return {type: 'facet_recovered', facet, at: time(seconds)};
}
