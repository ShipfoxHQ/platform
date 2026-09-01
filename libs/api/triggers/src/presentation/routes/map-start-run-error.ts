import type {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError} from '@shipfox/node-fastify';

type StartRunMethod =
  | typeof workflowsInterModuleContract.methods.startRunFromTrigger
  | typeof workflowsInterModuleContract.methods.startDevRun;

export function mapStartRunError(error: unknown, method: StartRunMethod): ClientError | undefined {
  if (!isInterModuleKnownError(method, error)) return undefined;

  switch (error.code) {
    case 'workspace-suspended':
      return new ClientError('Workspace is suspended', 'workspace-suspended', {
        status: 409,
        cause: error,
      });
    case 'workspace-deleted':
      return new ClientError('Workspace is deleted', 'workspace-deleted', {
        status: 404,
        cause: error,
      });
    case 'workspace-not-found':
      return new ClientError('Workspace not found', 'workspace-not-found', {
        status: 404,
        cause: error,
      });
    case 'agent-config-unresolvable':
      return new ClientError(
        'Agent configuration cannot be resolved',
        'agent-config-unresolvable',
        {
          status: 422,
          details: {definition_id: error.details.definitionId},
          cause: error,
        },
      );
    case 'agent-integration-materialization-failed':
      return new ClientError(
        'Agent integration configuration cannot be materialized',
        'agent-integration-materialization-failed',
        {status: 422, cause: error},
      );
    case 'interpolation-unresolvable':
      return new ClientError(
        'Workflow interpolation cannot be resolved',
        'workflow-interpolation-unresolvable',
        {
          status: 422,
          details: {
            field: error.details.field,
            source: error.details.source,
            ...(error.details.envKey === undefined ? {} : {env_key: error.details.envKey}),
          },
          cause: error,
        },
      );
    case 'invalid-job-runner-labels':
      return new ClientError(
        'Workflow requests invalid runner labels',
        'invalid-job-runner-labels',
        {
          status: 422,
          details: {labels: error.details.labels},
          cause: error,
        },
      );
    case 'source-snapshot-too-large':
      return new ClientError('Workflow source snapshot is too large', 'source-snapshot-too-large', {
        status: 422,
        details: {
          limit_bytes: error.details.limitBytes,
          measured_bytes: error.details.measuredBytes,
        },
        cause: error,
      });
    default:
      return undefined;
  }
}
