import {
  MAX_LISTENER_TRIGGER_EVENTS_BYTES,
  type WorkflowExecutionEventDto,
} from '@shipfox/api-workflows-dto';

export const PRODUCTION_RESOLVED_CONFIG_BYTES = 75_644;
export const PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES = 97_834;
export const LISTENER_FIRE_EVENT_LIMIT_BYTES = 768 * 1024;
export const LISTENER_EXECUTION_EVENT_LIMIT_BYTES = MAX_LISTENER_TRIGGER_EVENTS_BYTES;
export const PRODUCTION_BATCH_EVENT_BYTES = 400_000;
export const PRODUCTION_FIXTURE_RECEIVED_AT = '2026-09-04T00:00:00.000Z';

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function serializedUtf8ByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('Cannot measure an undefined JSON value');
  }
  return utf8ByteLength(serialized);
}

/** Builds a deterministic string with an exact UTF-8 byte length. */
export function exactUtf8Text(params: {
  targetBytes: number;
  prefix?: string | undefined;
  suffix?: string | undefined;
}): string {
  const prefix = params.prefix ?? '';
  const suffix = params.suffix ?? '';
  const fixedBytes = utf8ByteLength(prefix) + utf8ByteLength(suffix);
  const paddingBytes = params.targetBytes - fixedBytes;
  if (paddingBytes < 0) {
    throw new Error(
      `Cannot build UTF-8 fixture: measured fixed bytes=${fixedBytes}, target=${params.targetBytes}`,
    );
  }

  const asciiPaddingBytes = paddingBytes % 2;
  const padding = `${'a'.repeat(asciiPaddingBytes)}${'é'.repeat(
    (paddingBytes - asciiPaddingBytes) / 2,
  )}`;
  const result = `${prefix}${padding}${suffix}`;
  const measuredBytes = utf8ByteLength(result);
  if (measuredBytes !== params.targetBytes) {
    throw new Error(
      `UTF-8 fixture size mismatch: measured=${measuredBytes}, target=${params.targetBytes}`,
    );
  }
  return result;
}

export function assertSerializedUtf8ByteLength(
  value: unknown,
  targetBytes: number,
  label: string,
): void {
  const measuredBytes = serializedUtf8ByteLength(value);
  if (measuredBytes !== targetBytes) {
    throw new Error(
      `${label}: measured serialized UTF-8 bytes=${measuredBytes}, target=${targetBytes}`,
    );
  }
}

export interface ProductionListenerEventFixture {
  payload: Record<string, unknown>;
  expectedEvent: WorkflowExecutionEventDto;
  serializedBytes: number;
}

function productionWebhookPayload(deliveryId: string, marker: string): Record<string, unknown> {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-delivery-id': deliveryId,
    },
    query: {},
    body: {
      delivery_id: deliveryId,
      marker,
    },
  };
}

function normalizedListenerEvent(params: {
  source: string;
  deliveryId: string;
  payload: Record<string, unknown>;
  receivedAt: string;
}): WorkflowExecutionEventDto {
  return {
    source: params.source,
    event: 'received',
    delivery_id: params.deliveryId,
    received_at: params.receivedAt,
    project: null,
    repository: null,
    ref: null,
    commit: null,
    data: params.payload,
  };
}

export function buildProductionListenerEvent(params: {
  source: string;
  deliveryId: string;
  targetBytes: number;
  receivedAt?: string | undefined;
}): ProductionListenerEventFixture {
  const receivedAt = params.receivedAt ?? PRODUCTION_FIXTURE_RECEIVED_AT;
  const emptyPayload = productionWebhookPayload(params.deliveryId, '');
  const emptyEvent = normalizedListenerEvent({
    source: params.source,
    deliveryId: params.deliveryId,
    payload: emptyPayload,
    receivedAt,
  });
  const marker = exactUtf8Text({
    targetBytes: params.targetBytes - serializedUtf8ByteLength([emptyEvent]),
  });
  const payload = productionWebhookPayload(params.deliveryId, marker);
  const expectedEvent = normalizedListenerEvent({
    source: params.source,
    deliveryId: params.deliveryId,
    payload,
    receivedAt,
  });
  assertSerializedUtf8ByteLength([expectedEvent], params.targetBytes, 'listener event fixture');
  return {payload, expectedEvent, serializedBytes: params.targetBytes};
}

export function buildProductionResolvedStepConfig(): {run: string} {
  const prefix = "PAYLOAD='";
  const suffix = `'; printf 'resolved_config_bytes=%s\\n' "$(printf '%s' "$PAYLOAD" | wc -c | tr -d ' ')"`;
  const fixedString = `${prefix}${suffix}`;
  const serializedOverhead =
    serializedUtf8ByteLength({run: fixedString}) - utf8ByteLength(fixedString);
  const run = exactUtf8Text({
    targetBytes: PRODUCTION_RESOLVED_CONFIG_BYTES - serializedOverhead,
    prefix,
    suffix,
  });
  const config = {run};
  assertSerializedUtf8ByteLength(config, PRODUCTION_RESOLVED_CONFIG_BYTES, 'resolved step config');
  return config;
}

export function productionResolvedConfigWorkflow(): string {
  const {run} = buildProductionResolvedStepConfig();
  return `
name: Production resolved step config
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  build:
    steps:
      - key: sized-config
        run: |-
          ${run}
`;
}

export function productionPayloadListenerWorkflow(params: {batchMaxSize?: number} = {}): string {
  const batch =
    params.batchMaxSize === undefined
      ? ''
      : `      batch:
        debounce: 5s
        max_size: ${params.batchMaxSize}
        max_wait: 30s
`;
  return `
name: Production payload listener
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  listen:
    listening:
      on:
        - source: __FIRE_WEBHOOK_SOURCE__
          event: received
      until:
        - source: __RESOLVE_WEBHOOK_SOURCE__
          event: received
${batch}    steps:
      - key: acknowledge
        run: echo "production_payload_received"
`;
}
