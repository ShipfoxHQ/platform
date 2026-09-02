import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {stepAttemptDetailResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getStepAttemptDetail} from '#db/index.js';
import {toStepAttemptDetailResponseDto} from '#presentation/dto/step.js';
import {requireAccessibleRun} from './require-accessible-run.js';

export function getStepAttemptDetailRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/steps/:stepId/attempts/:attempt',
    description: 'Get troubleshooting details for one step attempt',
    schema: {
      params: z.object({
        stepId: z.string().uuid(),
        attempt: z.coerce.number().int().positive(),
      }),
      response: {
        200: stepAttemptDetailResponseSchema,
      },
    },
    handler: async (request) => {
      const detail = await getStepAttemptDetail(request.params);
      if (!detail) {
        throw new ClientError('Step attempt not found', 'not-found', {status: 404});
      }

      await requireAccessibleRun({request, id: detail.workflowRunId, projects});
      return toStepAttemptDetailResponseDto(
        detail.step,
        detail.attempt,
        {
          workflowRunId: detail.workflowRunId,
          workflowRunAttempt: detail.workflowRunAttempt,
          jobId: detail.jobId,
          jobExecutionId: detail.jobExecutionId,
        },
        detail.diagnosticBytes,
      );
    },
  });
}
