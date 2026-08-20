import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {getUncompactedChunkBytes} from '#db/chunks.js';
import {getOpenStreamCount} from '#db/streams.js';

export function registerLogsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('logs');

  const openStreams = meter.createObservableGauge('logs_open_streams', {
    description: 'Log streams currently open for appends',
  });

  // Hot-storage volume on the service plane: the chunk rows live in shared Postgres, so every
  // pod would report the same sum and Prometheus must not add them together.
  const openChunkBytes = meter.createObservableGauge('logs_open_chunk_bytes', {
    description:
      'Bytes in un-compacted hot log chunks (open streams plus closed streams awaiting compaction)',
    unit: 'By',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      observer.observe(openStreams, toSafeGaugeNumber(await getOpenStreamCount()));
      observer.observe(openChunkBytes, toSafeGaugeNumber(await getUncompactedChunkBytes()));
    },
    [openStreams, openChunkBytes],
  );
}

function toSafeGaugeNumber(value: bigint): number {
  // OpenTelemetry gauges accept numbers; clamp unrepresentable DB counts rather than round them.
  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return Number.MAX_SAFE_INTEGER;
}
