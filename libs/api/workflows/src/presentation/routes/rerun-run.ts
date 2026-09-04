import {requireUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {rerunWorkflowRunBodySchema, workflowRunResponseSchema} from '@shipfox/api-workflows-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  NoFailedJobsError,
  RunNotTerminalError,
  SourceRunNotFoundError,
  WorkflowAdmissionDeniedError,
  WorkspaceDeletedError,
  WorkspaceNotFoundError,
  WorkspaceSuspendedError,
} from '#core/errors.js';
import {
  assertWorkspaceAdmitsNewJobs,
  type WorkflowAdmissionPolicy,
} from '#core/workspace-admission.js';
import {createRerunWorkflowRun} from '#db/index.js';
import {toRunDto} from '#presentation/dto/index.js';
import {requireAccessibleRun} from './require-accessible-run.js';

const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});

export function rerunRunRoute(
  projects: ProjectsModuleClient,
  workspaces: WorkspacesInterModuleClient,
  admission?: {policy: WorkflowAdmissionPolicy} | undefined,
) {
  return defineRoute({
    method: 'POST',
    path: '/:id/rerun',
    description: 'Re-run a terminal workflow run',
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      body: rerunWorkflowRunBodySchema,
      response: {
        200: workflowRunResponseSchema,
        409: errorResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (error instanceof SourceRunNotFoundError) {
        throw new ClientError('Run not found', 'not-found', {status: 404});
      }
      if (error instanceof RunNotTerminalError) {
        throw new ClientError('Run is not terminal', 'run-not-terminal', {status: 409});
      }
      if (error instanceof NoFailedJobsError) {
        throw new ClientError('Run has no failed jobs', 'no-failed-jobs', {status: 409});
      }
      if (error instanceof WorkspaceSuspendedError) {
        throw new ClientError('Workspace is suspended', 'workspace-suspended', {
          status: 409,
          cause: error,
        });
      }
      if (error instanceof WorkspaceDeletedError) {
        throw new ClientError('Workspace is deleted', 'workspace-deleted', {
          status: 404,
          cause: error,
        });
      }
      if (error instanceof WorkspaceNotFoundError) {
        throw new ClientError('Workspace not found', 'workspace-not-found', {
          status: 404,
          cause: error,
        });
      }
      if (error instanceof WorkflowAdmissionDeniedError) {
        throw new ClientError('Workflow admission denied', 'admission-denied', {
          status: 409,
          details: admissionDeniedDetails(error),
          cause: error,
        });
      }
      throw error;
    },
    handler: async (request) => {
      const {id} = request.params;
      const sourceRun = await requireAccessibleRun({request, id, projects});

      await assertWorkspaceAdmitsNewJobs(workspaces, sourceRun.workspaceId, {
        policy: admission?.policy,
        source: sourceRun.triggerSource,
        definitionId: sourceRun.definitionId,
      });

      const actor = requireUserContext(request);
      const run = await createRerunWorkflowRun({
        workflowRunId: sourceRun.id,
        mode: request.body.mode,
        actorUserId: actor.userId,
      });

      return toRunDto(run, run.currentAttempt);
    },
  });
}

function admissionDeniedDetails(error: WorkflowAdmissionDeniedError) {
  return {
    workspace_id: error.workspaceId,
    reason: error.reason,
    ...(error.requiredAction === undefined
      ? {}
      : {
          required_action: {
            reason: error.requiredAction.reason,
            message: error.requiredAction.message,
            url: error.requiredAction.url,
          },
        }),
  };
}
