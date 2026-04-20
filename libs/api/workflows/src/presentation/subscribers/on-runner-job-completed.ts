import type {RunnerJobCompletedEvent} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {temporalClient} from '@shipfox/node-temporal';

export async function onRunnerJobCompleted(event: DomainEvent): Promise<void> {
  const payload = event.payload as RunnerJobCompletedEvent;
  logger().info({jobId: payload.jobId, status: payload.status}, 'Signaling job orchestration');
  const handle = temporalClient().workflow.getHandle(`job:${payload.jobId}`);
  await handle.signal('job-completed', {
    status: payload.status,
    output: payload.output,
  });
}
