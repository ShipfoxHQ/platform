import {
  type Attributes,
  type Context,
  type Counter,
  type Gauge,
  type Histogram,
  type Meter,
  type MetricAttributes,
  metrics,
  type Observable,
  type ObservableCallback,
  type ObservableCounter,
  type ObservableGauge,
  type ObservableResult,
  type ObservableUpDownCounter,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
  type UpDownCounter,
} from '@opentelemetry/api';
import {shutdownInstanceInstrumentation} from './instance.js';
import {getServiceMetricsProvider, shutdownServiceMetrics} from './service.js';

import './diag.js';

export type {InstrumentationOptions} from './common.js';
export {contextWithMetadata, enrichSpanWithMetadata, getContextMetadata} from './context.js';
export {getFastifyInstrumentation, startInstanceInstrumentation} from './instance.js';
export {logger} from './logger.js';
export {extractContextFromAttributes, injectContextToAttributes} from './propagation.js';
export {startServiceMetrics} from './service.js';

export async function shutdownInstrumentation() {
  await shutdownInstanceInstrumentation();
  await shutdownServiceMetrics();
}

export type {
  Attributes,
  Context,
  Counter,
  Gauge,
  Histogram,
  Meter,
  MetricAttributes,
  Observable,
  ObservableCallback,
  ObservableCounter,
  ObservableGauge,
  ObservableResult,
  ObservableUpDownCounter,
  Span,
  UpDownCounter,
};
export {getServiceMetricsProvider, metrics as instanceMetrics, SpanKind, SpanStatusCode, trace};
