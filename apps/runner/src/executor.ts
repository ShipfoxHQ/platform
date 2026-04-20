import type {JobPayloadDto} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {executeRunStep} from '#run-step.js';

export async function executeJob(
  job: JobPayloadDto,
): Promise<{status: 'succeeded' | 'failed'; output: string}> {
  const steps = [...job.steps].sort((a, b) => a.position - b.position);
  let output = '';

  for (const step of steps) {
    const stepLabel = step.name ?? `step #${step.position}`;
    logger().info(
      {stepId: step.id, stepName: step.name, position: step.position},
      `Running ${stepLabel}`,
    );

    const result = await executeRunStep(step);
    output += result.output;

    if (!result.success) {
      logger().error({stepId: step.id, stepName: step.name}, `Step ${stepLabel} failed`);
      return {status: 'failed', output};
    }

    logger().info({stepId: step.id, stepName: step.name}, `Step ${stepLabel} succeeded`);
  }

  return {status: 'succeeded', output};
}
