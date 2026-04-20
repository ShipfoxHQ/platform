import {type IMetricReader, MeterProvider} from '@opentelemetry/sdk-metrics';
import {config} from '#config.js';
import {getMetricsReader, getResource, type StartInstrumentationOptions} from './common.js';

let serviceMetricsProvider: MeterProvider | undefined;
let serviceMetricReader: IMetricReader | undefined;

export function startServiceMetrics(options?: StartInstrumentationOptions) {
  if (serviceMetricsProvider) return serviceMetricsProvider;

  const resource = getResource(options?.serviceName);
  serviceMetricReader = getMetricsReader({
    port: config.OTEL_SERVICE_METRICS_PORT,
    endpoint: '/metrics',
    ...options?.exporter?.service,
  });
  serviceMetricsProvider = new MeterProvider({readers: [serviceMetricReader], resource});
  return serviceMetricsProvider;
}

export function getServiceMetricsProvider() {
  if (!serviceMetricsProvider) return startServiceMetrics();
  return serviceMetricsProvider;
}

export async function shutdownServiceMetrics() {
  await serviceMetricsProvider?.shutdown();
  serviceMetricsProvider = new MeterProvider();
  serviceMetricReader = undefined;
}
