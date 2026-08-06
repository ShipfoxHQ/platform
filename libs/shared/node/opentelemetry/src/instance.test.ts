import {context, type Span, TraceFlags, trace} from '@opentelemetry/api';
import {logs} from '@opentelemetry/api-logs';
import {PinoInstrumentation} from '@opentelemetry/instrumentation-pino';
import {resourceFromAttributes} from '@opentelemetry/resources';
import {InMemoryLogRecordExporter, SimpleLogRecordProcessor} from '@opentelemetry/sdk-logs';
import {NodeSDK} from '@opentelemetry/sdk-node';
import {createLogger} from '@shipfox/node-log';
import {afterEach, beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {logger as contextLogger} from './logger.js';

let exporter: InMemoryLogRecordExporter;
let sdk: NodeSDK;
let instrumentation: PinoInstrumentation;

beforeEach(() => {
  exporter = new InMemoryLogRecordExporter();
  instrumentation = new PinoInstrumentation();
  sdk = new NodeSDK({
    autoDetectResources: false,
    instrumentations: [instrumentation],
    logRecordProcessors: [new SimpleLogRecordProcessor(exporter)],
    metricReaders: [],
    resource: resourceFromAttributes({'service.name': 'telemetry-test'}),
    spanProcessors: [],
  });
  sdk.start();
});

afterEach(async () => {
  instrumentation.disable();
  await sdk.shutdown();
  logs.disable();
});

describe('Pino log export', () => {
  it('sends shared logger records to OTLP with trace context and resource metadata', async () => {
    const logger = createLogger({
      level: 'info',
      transport: {target: 'pino/file', options: {destination: '/dev/null'}},
    });

    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const activeContext = trace.setSpan(context.active(), {
      spanContext: () => ({
        traceId,
        spanId: '00f067aa0ba902b7',
        traceFlags: TraceFlags.SAMPLED,
        isRemote: false,
      }),
    } as unknown as Span);
    const cause = Object.assign(new Error('permission denied'), {
      name: 'UnauthorizedOperation',
    });

    context.with(activeContext, () => {
      logger.info({organizationId: 'org-123'}, 'info message');
      logger.warn('warn message');
      logger.error({err: new Error('boom', {cause}), operation: 'sync'}, 'error message');
      logger.error(
        {error: new Error('alias boom', {cause}), operation: 'sync-alias'},
        'aliased error message',
      );
    });

    await new Promise<void>((resolve, reject) =>
      logger.flush((error?: Error) => (error ? reject(error) : resolve())),
    );

    const records = [...exporter.getFinishedLogRecords()];
    const firstRecord = records[0];
    const errorRecord = records[2];
    const aliasedErrorRecord = records[3];
    expect(records).toHaveLength(4);
    expect(records.map((record) => record.body)).toEqual([
      'info message',
      'warn message',
      'error message',
      'aliased error message',
    ]);
    expect(firstRecord).toMatchObject({
      attributes: {organizationId: 'org-123'},
      resource: {attributes: {'service.name': 'telemetry-test'}},
      severityText: 'info',
      spanContext: {traceId},
    });
    expect(firstRecord?.attributes).not.toHaveProperty('trace_id');
    expect(firstRecord?.attributes).not.toHaveProperty('span_id');
    expect(errorRecord).toMatchObject({
      attributes: {
        'exception.message': 'boom: permission denied',
        'exception.type': 'Error',
        operation: 'sync',
      },
      severityText: 'error',
    });
    expect(errorRecord?.attributes['exception.stacktrace']).toContain(
      'caused by: UnauthorizedOperation: permission denied',
    );
    expect(aliasedErrorRecord).toMatchObject({
      attributes: {
        'exception.message': 'alias boom: permission denied',
        'exception.type': 'Error',
        operation: 'sync-alias',
      },
      severityText: 'error',
    });
    expect(aliasedErrorRecord?.attributes['exception.stacktrace']).toContain(
      'caused by: UnauthorizedOperation: permission denied',
    );
    expect(aliasedErrorRecord?.attributes).not.toHaveProperty('error');
    expect(errorRecord?.hrTime).toBeDefined();

    const configuredLogger = context.with(activeContext, () =>
      contextLogger({
        base: {component: 'context-aware'},
        level: 'info',
        transport: {target: 'pino/file', options: {destination: '/dev/null'}},
      }),
    );
    context.with(activeContext, () => {
      configuredLogger.info({requestId: 'req-123'}, 'context-aware message');
    });
    await new Promise<void>((resolve, reject) =>
      configuredLogger.flush((error?: Error) => (error ? reject(error) : resolve())),
    );

    const contextRecord = exporter.getFinishedLogRecords()[4];
    expect(contextRecord).toMatchObject({
      attributes: {component: 'context-aware', requestId: 'req-123'},
      spanContext: {traceId},
    });
  });
});
