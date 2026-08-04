import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code} from '@shipfox/react-ui/typography';
import type {WorkflowRun} from '#core/workflow-run.js';

type WorkflowRunNumberLabelRun = Pick<WorkflowRun, 'number' | 'workflowName'> &
  Partial<Pick<WorkflowRun, 'name'>>;

export function formatWorkflowRunNumberLabel({
  number,
  workflowName,
}: WorkflowRunNumberLabelRun): string | undefined {
  return number === null ? undefined : `${workflowName} #${number}`;
}

/**
 * The run's identity beside its name.
 *
 * A run whose name was never overridden carries its workflow name twice on one line, so the
 * visible label drops to the bare number in that case. The full label stays in the tooltip
 * and in `formatWorkflowRunNumberLabel`, which feeds accessible names.
 */
export function WorkflowRunNumberLabel({run}: {run: WorkflowRunNumberLabelRun}) {
  const label = formatWorkflowRunNumberLabel(run);
  if (label === undefined) return null;

  const namesTheWorkflowTwice = run.name === run.workflowName;
  const visibleLabel = namesTheWorkflowTwice ? `#${run.number}` : label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Code
          as="span"
          variant="label"
          className="min-w-0 max-w-[240px] truncate text-foreground-neutral-muted"
        >
          {visibleLabel}
        </Code>
      </TooltipTrigger>
      <TooltipContent>
        <Code as="span" variant="label" className="block max-w-[360px] break-words">
          {label}
        </Code>
      </TooltipContent>
    </Tooltip>
  );
}
