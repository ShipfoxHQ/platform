import {
  MAX_LISTENER_TRIGGER_EVENTS_BYTES,
  MAX_RESOLVED_STEP_CONFIG_BYTES,
  WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES,
} from '@shipfox/api-workflows-dto';
import {
  buildProductionListenerEvent,
  buildProductionResolvedStepConfig,
  PRODUCTION_BATCH_EVENT_BYTES,
  PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES,
  PRODUCTION_RESOLVED_CONFIG_BYTES,
  serializedUtf8ByteLength,
} from './production-payloads.js';

describe('production-shaped workflow payload fixtures', () => {
  test('builds the exact resolved config incident size below the execution limit', () => {
    const config = buildProductionResolvedStepConfig();

    expect(serializedUtf8ByteLength(config)).toBe(PRODUCTION_RESOLVED_CONFIG_BYTES);
    expect(PRODUCTION_RESOLVED_CONFIG_BYTES).toBeGreaterThan(WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES);
    expect(PRODUCTION_RESOLVED_CONFIG_BYTES).toBeLessThan(MAX_RESOLVED_STEP_CONFIG_BYTES);
  });

  test('builds an exact normalized trigger event with multibyte padding', () => {
    const fixture = buildProductionListenerEvent({
      source: 'listener-fire-fixture',
      deliveryId: 'delivery-fixture',
      targetBytes: PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES,
    });

    expect(fixture.serializedBytes).toBe(PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES);
    expect(serializedUtf8ByteLength([fixture.expectedEvent])).toBe(
      PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES,
    );
    expect(fixture.payload).toMatchObject({
      method: 'POST',
      body: {delivery_id: 'delivery-fixture'},
    });
  });

  test('makes three batch events exceed the execution ceiling while two fit', () => {
    const fixtures = ['a', 'b', 'c'].map((suffix) =>
      buildProductionListenerEvent({
        source: 'listener-batch-fixture',
        deliveryId: `delivery-${suffix}`,
        targetBytes: PRODUCTION_BATCH_EVENT_BYTES,
      }),
    );

    expect(
      serializedUtf8ByteLength(fixtures.slice(0, 2).map((fixture) => fixture.expectedEvent)),
    ).toBeLessThanOrEqual(MAX_LISTENER_TRIGGER_EVENTS_BYTES);
    expect(
      serializedUtf8ByteLength(fixtures.map((fixture) => fixture.expectedEvent)),
    ).toBeGreaterThan(MAX_LISTENER_TRIGGER_EVENTS_BYTES);
  });
});
