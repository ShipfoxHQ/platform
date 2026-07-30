import type {WorkflowInterpolationField, WorkflowPredicateField} from '@shipfox/expression';

export function workflowFieldLabel(
  field: WorkflowInterpolationField | WorkflowPredicateField,
): string {
  switch (field) {
    case 'run':
      return 'Run command interpolation';
    case 'env.value':
      return 'Env value interpolation';
    case 'agent.prompt':
      return 'Agent prompt interpolation';
    case 'agent.model':
      return 'Agent model interpolation';
    case 'agent.provider':
      return 'Agent provider interpolation';
    case 'agent.thinking':
      return 'Agent thinking';
    case 'job.runner':
      return 'Job runner interpolation';
    case 'job.outputs':
      return 'Job outputs mapping';
    case 'job.name':
      return 'Job name interpolation';
    case 'workflow.run_name':
      return 'Workflow run name interpolation';
    case 'job.execution_name':
      return 'Job execution name interpolation';
    case 'step.name':
      return 'Step name interpolation';
    case 'step.working_directory':
      return 'Step working directory interpolation';
    case 'step.success':
      return 'Step gate success';
    case 'step.feedback':
      return 'Step feedback';
    case 'job.success':
      return 'Job success';
    case 'trigger.filter':
      return 'Trigger filter';
    case 'listener.on':
      return 'Listener on filter';
    case 'listener.until':
      return 'Listener until filter';
    case 'job.if':
      return 'Job if';
    case 'step.if':
      return 'Step if';
    default:
      return assertNever(field);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workflow field: ${value}`);
}
