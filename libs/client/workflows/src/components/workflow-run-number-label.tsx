import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code} from '@shipfox/react-ui/typography';
import type {WorkflowRun} from '#core/workflow-run.js';

type WorkflowRunNumberLabelRun = Pick<WorkflowRun, 'number' | 'workflowName'>;

export function formatWorkflowRunNumberLabel({
  number,
  workflowName,
}: WorkflowRunNumberLabelRun): string | undefined {
  return number === null ? undefined : `${workflowName} #${number}`;
}

export function WorkflowRunNumberLabel({run}: {run: WorkflowRunNumberLabelRun}) {
  const label = formatWorkflowRunNumberLabel(run);
  if (label === undefined) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Code
          as="span"
          variant="label"
          className="min-w-0 max-w-[240px] truncate text-foreground-neutral-muted"
        >
          {label}
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
