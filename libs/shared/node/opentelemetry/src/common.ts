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
import {ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION} from '@opentelemetry/semantic-conventions';
import {bool, createConfig, str, url} from '@shipfox/config';

export const env = createConfig({
  OTEL_SERVICE_NAME: str({
    desc: 'Service name reported on the telemetry this process emits. Leave it unset to use the auto-detected resource name.',
    default: undefined,
  }),
  OTEL_EXPORTER_OTLP_ENDPOINT: url({
    desc: 'Base OTLP endpoint used to export telemetry signals. Signal-specific endpoints take precedence.',
    default: undefined,
  }),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: url({
    desc: 'Exact OTLP endpoint used to export traces. This takes precedence over OTEL_EXPORTER_OTLP_ENDPOINT and normally ends in /v1/traces.',
    default: undefined,
  }),
  OTEL_SDK_DISABLED: bool({
    desc: 'Disables all OpenTelemetry tracing, logs, and metrics when set to true.',
    default: false,
  }),
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
  awsSdk?: boolean;
  cassandraDriver?: boolean;
  grpc?: boolean;
  pino?: boolean;
}

export interface StartInstrumentationOptions {
  serviceName?: string;
  serviceVersion?: string;
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

type ResourceEnvironment = Pick<typeof env, 'OTEL_SERVICE_NAME'>;

type TelemetryEnvironment = Pick<
  typeof env,
  'OTEL_EXPORTER_OTLP_ENDPOINT' | 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT' | 'OTEL_SDK_DISABLED'
>;

export function getMetricsReader(config: PrometheusExporterConfig): PrometheusExporter {
  return new PrometheusExporter(config);
}

export function getResource(
  options: Pick<StartInstrumentationOptions, 'serviceName' | 'serviceVersion'> = {},
  environment: ResourceEnvironment = env,
): Resource {
  const defaults = resourceFromAttributes({
    ...(options.serviceName ? {[ATTR_SERVICE_NAME]: options.serviceName} : {}),
    ...(options.serviceVersion ? {[ATTR_SERVICE_VERSION]: options.serviceVersion} : {}),
  });
  let resource = defaults.merge(
    detectResources({
      detectors: [envDetector, processDetector, hostDetector, osDetector],
    }),
  );
  if (environment.OTEL_SERVICE_NAME) {
    resource = resource.merge(
      resourceFromAttributes({[ATTR_SERVICE_NAME]: environment.OTEL_SERVICE_NAME}),
    );
  }
  return resource;
}

export function shouldStartTelemetry(environment: TelemetryEnvironment = env): boolean {
  return !environment.OTEL_SDK_DISABLED;
}

export function shouldExportTraces(environment: TelemetryEnvironment = env): boolean {
  return Boolean(
    environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? environment.OTEL_EXPORTER_OTLP_ENDPOINT,
  );
}
