import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {workflowRunDetailResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkflowRunDetail} from '#db/index.js';
import {
  toJobDto,
  toJobExecutionDto,
  toRunAttemptDto,
  toRunDto,
  toStepAttemptDto,
  toStepDto,
} from '#presentation/dto/index.js';
import {requireAccessibleRun} from './require-accessible-run.js';

export function getRunRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/:id',
    description: 'Get a workflow run by ID with jobs and steps',
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      querystring: z.object({
        attempt: z.coerce.number().int().positive().optional(),
      }),
      response: {
        200: workflowRunDetailResponseSchema,
      },
    },
    handler: async (request) => {
      const {id} = request.params;
      await requireAccessibleRun({request, id, projects});

      const run = await getWorkflowRunDetail(id, request.query.attempt);
      if (!run) {
        throw new ClientError('Run not found', 'not-found', {status: 404});
      }

      const jobDtos = run.jobs.map((job) => ({
        ...toJobDto(job),
        job_executions: job.jobExecutions.map((jobExecution) => ({
          ...toJobExecutionDto(jobExecution),
          steps: jobExecution.steps.map((step) => {
            const attempts = step.attempts.map(toStepAttemptDto);
            const latestTerminalAttempt = attempts
              .filter((attempt) => attempt.status !== 'running')
              .at(-1);
            return {
              ...toStepDto(step),
              exit_code: latestTerminalAttempt?.exit_code ?? null,
              outputs: latestTerminalAttempt?.outputs ?? null,
              response: latestTerminalAttempt?.response ?? null,
              gate_result: latestTerminalAttempt?.gate_result ?? null,
              attempts,
            };
          }),
        })),
      }));

      return {
        ...toRunDto(run, run.latestAttempt),
        run_attempt: toRunAttemptDto(run.runAttempt),
        jobs: jobDtos,
        has_started_job_execution: run.hasStartedJobExecution,
      };
    },
  });
}
