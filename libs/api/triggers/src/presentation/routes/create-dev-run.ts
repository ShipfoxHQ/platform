import {requireUserContext} from '@shipfox/api-auth-context';
import {
  type DefinitionsInterModuleClient,
  definitionsInterModuleContract,
} from '@shipfox/api-definitions-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {createDevRunBodySchema, createDevRunResponseSchema} from '@shipfox/api-triggers-dto';
import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {createDevRun} from '#core/create-dev-run.js';
import {
  DevRunInputsNotAllowedError,
  DevRunReplayEventMismatchError,
  DevRunReplayEventNotAllowedError,
  DevRunReplayEventNotFoundError,
  DevRunReplayEventRequiredError,
  DevRunReplayEventUnavailableError,
  DevRunTriggerFilteredError,
  DevRunTriggerNotFoundError,
} from '#core/errors.js';
import {mapStartRunError} from './map-start-run-error.js';
import {requireProjectAccess} from './project-access.js';

// Error responses use several shapes: bare codes (`trigger-not-found`, …) and
// codes with details (`invalid-workflow-definition`, `workflow-interpolation-unresolvable`).
const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});

export function createDevRunRoute(
  workflows: WorkflowsModuleClient,
  definitions: DefinitionsInterModuleClient,
  projects: ProjectsModuleClient,
) {
  return defineRoute({
    method: 'POST',
    path: '/',
    description:
      'Create a dev run from a workflow file at a git ref for a manual, cron, or replayed integration trigger.',
    schema: {
      body: createDevRunBodySchema,
      response: {
        201: createDevRunResponseSchema,
        422: errorResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
        410: errorResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (error instanceof DevRunTriggerNotFoundError) {
        throw new ClientError(error.message, 'trigger-not-found', {status: 422});
      }
      if (error instanceof DevRunInputsNotAllowedError) {
        throw new ClientError(error.message, 'inputs-not-allowed', {status: 422});
      }
      if (error instanceof DevRunReplayEventRequiredError) {
        throw new ClientError(error.message, 'replay-event-required', {status: 422});
      }
      if (error instanceof DevRunReplayEventNotAllowedError) {
        throw new ClientError(error.message, 'replay-event-not-allowed', {status: 422});
      }
      if (error instanceof DevRunReplayEventNotFoundError) {
        throw new ClientError(error.message, 'replay-event-not-found', {
          status: 404,
          cause: error,
        });
      }
      if (error instanceof DevRunReplayEventMismatchError) {
        throw new ClientError(error.message, 'replay-event-mismatch', {
          status: 409,
          cause: error,
        });
      }
      if (error instanceof DevRunReplayEventUnavailableError) {
        throw new ClientError(error.message, 'replay-event-unavailable', {
          status: 410,
          cause: error,
        });
      }
      if (error instanceof DevRunTriggerFilteredError) {
        // The reason travels in `details` so the client can show why; the
        // events page journal shows the same reason on the `filter-error`
        // decision.
        throw new ClientError('The trigger filter refused the replayed event', 'trigger-filtered', {
          status: 409,
          details: {reason: error.reason},
          cause: error,
        });
      }
      if (
        isInterModuleKnownError(
          definitionsInterModuleContract.methods.resolveDefinitionAtRef,
          error,
        )
      ) {
        switch (error.code) {
          case 'project-not-found':
            throw new ClientError('Project not found', 'project-not-found', {
              status: 404,
              cause: error,
            });
          case 'ref-not-found':
            throw new ClientError('Git ref not found', 'ref-not-found', {
              status: 404,
              cause: error,
            });
          case 'file-not-found':
            throw new ClientError('Workflow file not found at the ref', 'file-not-found', {
              status: 404,
              cause: error,
            });
          case 'ref-invalid':
            throw new ClientError('Git ref is not a resolvable branch or tag name', 'ref-invalid', {
              status: 400,
              cause: error,
            });
          case 'ref-moved':
            throw new ClientError('The ref no longer points at the pinned commit', 'ref-moved', {
              status: 409,
              cause: error,
            });
          case 'invalid-definition':
            throw new ClientError('Invalid workflow definition', 'invalid-workflow-definition', {
              status: 422,
              details: {errors: error.details.errors},
              cause: error,
            });
          case 'content-too-large':
            throw new ClientError('Workflow file is too large', 'content-too-large', {
              status: 422,
              cause: error,
            });
          case 'source-unavailable':
            throw new ClientError('The source repository is unavailable', 'source-unavailable', {
              status: 502,
              cause: error,
            });
        }
      }
      const clientError = mapStartRunError(error, workflowsInterModuleContract.methods.startDevRun);
      if (clientError) throw clientError;
      throw error;
    },
    handler: async (request, reply) => {
      const userContext = requireUserContext(request);
      const {project_id, ref, commit, config_path, trigger, inputs, replay_event_id} = request.body;
      const {workspaceId} = await requireProjectAccess(request, project_id, projects);

      const run = await createDevRun({
        definitions,
        workflows,
        workspaceId,
        projectId: project_id,
        ref,
        commit,
        configPath: config_path,
        triggerKey: trigger,
        inputs,
        replayEventId: replay_event_id,
        userId: userContext.userId,
      });

      reply.status(201);
      return {workflow_run_id: run.id, commit: run.commit};
    },
  });
}
