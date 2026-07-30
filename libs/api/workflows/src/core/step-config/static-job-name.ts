import type {WorkflowModel} from '@shipfox/api-definitions-dto';

type WorkflowModelJob = WorkflowModel['jobs'][number];

export function staticJobName(job: WorkflowModelJob): string | undefined {
  const literalValues = job.name?.flatMap((segment) =>
    segment.kind === 'literal' ? [segment.value] : [],
  );
  if (literalValues === undefined || literalValues.length !== job.name?.length) return undefined;
  return literalValues.join('');
}
