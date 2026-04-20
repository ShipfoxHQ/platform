import type {ClientInterceptors} from '@temporalio/client';
import type {WorkerInterceptors} from '@temporalio/worker';

export function getClientInterceptors(): ClientInterceptors {
  return {};
}

export function getWorkerInterceptors(): WorkerInterceptors {
  return {
    activity: [],
  };
}

export function getWorkflowInterceptorModules(): string[] {
  return [];
}
