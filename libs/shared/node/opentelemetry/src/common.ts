import {
  PrometheusExporter,
  type ExporterConfig as PrometheusExporterConfig,
} from '@opentelemetry/exporter-prometheus';
import {
  detectResources,
  envDetector,
  hostDetector,
  osDetector,
  processDetector,
  type Resource,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import {ATTR_SERVICE_NAME} from '@opentelemetry/semantic-conventions';
import {createConfig, str, url} from '@shipfox/config';

export const env = createConfig({
  OTEL_SERVICE_NAME: str({default: undefined}),
  TRACES_COLLECTOR_URL: url({default: undefined}),
});

/**
 * Selectively enable individual instrumentations to reduce startup time.
 * When `instrumentations` is omitted from `StartInstrumentationOptions`, all
 * Node.js auto-instrumentations are enabled (the default behaviour).
 */
export interface InstrumentationOptions {
  /** Fastify route tracing via @fastify/otel. @default true */
  fastify?: boolean;
  http?: boolean;
  net?: boolean;
  dns?: boolean;
  pg?: boolean;
  ioredis?: boolean;
  undici?: boolean;
  cassandraDriver?: boolean;
  grpc?: boolean;
  pino?: boolean;
}

export interface StartInstrumentationOptions {
  serviceName?: string;
  /**
   * Instrumentations to enable. When omitted, all Node.js auto-instrumentations
   * are loaded (equivalent to `getNodeAutoInstrumentations()`).
   *
   * Provide an `InstrumentationOptions` object to selectively enable only what
   * your app uses. This avoids eagerly loading ~40 instrumentation packages on
   * startup, which significantly reduces boot time.
   *
   * @example
   * startInstanceInstrumentation({
   *   serviceName: 'api',
   *   instrumentations: { pg: true, ioredis: true, http: true },
   * });
   */
  instrumentations?: InstrumentationOptions;
  exporter?: {
    instance: PrometheusExporterConfig;
    service: PrometheusExporterConfig;
  };
}

export function getMetricsReader(config: PrometheusExporterConfig): PrometheusExporter {
  return new PrometheusExporter(config);
}

export function getResource(serviceName?: string): Resource {
  return detectResources({
    detectors: [envDetector, processDetector, hostDetector, osDetector],
  }).merge(resourceFromAttributes({[ATTR_SERVICE_NAME]: serviceName ?? env.OTEL_SERVICE_NAME}));
}
