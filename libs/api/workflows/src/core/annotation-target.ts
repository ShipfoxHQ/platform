import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import type {LeasedJobContext} from '@shipfox/api-auth-context';

export function annotationTargetFromLease(
  lease: LeasedJobContext,
): Omit<
  Parameters<AnnotationsInterModuleClient['replaceOrRemoveAnnotation']>[0],
  'originStepId' | 'originStepAttempt' | 'context' | 'annotation'
> {
  return {
    workspaceId: lease.workspaceId,
    projectId: lease.projectId,
    workflowRunId: lease.workflowRunId,
    workflowRunAttempt: lease.workflowRunAttempt ?? 1,
    workflowRunAttemptId: lease.workflowRunAttemptId,
    jobId: lease.jobId,
    jobExecutionId: lease.jobExecutionId,
  };
}
