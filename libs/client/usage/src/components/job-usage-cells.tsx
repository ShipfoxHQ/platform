import {Code} from '@shipfox/react-ui/typography';
import {useMemo} from 'react';
import {type JobExecutionUsage, usageTokenTotalsForSegments} from '#core/usage.js';
import {useUsageCosts} from './usage-cost.js';
import {UsageCostBadge} from './usage-cost-badge.js';
import {formatUsageDuration, formatUsageNumber, usageQuantitiesFromTotals} from './usage-format.js';

export interface JobUsageCellsProps {
  usage: JobExecutionUsage | undefined;
  className?: string | undefined;
}

/** The compact usage cells appended to a run's job row or selected-job header. */
export function JobUsageCells({usage, className}: JobUsageCellsProps) {
  const totals = useMemo(
    () => (usage ? usageTokenTotalsForSegments(usage.inferenceSegments) : undefined),
    [usage],
  );
  const jobExecutionId = usage?.jobExecution.jobExecutionId;
  const durationSeconds = usage?.jobExecution.durationSeconds;
  const pricingInputs = useMemo(
    () =>
      jobExecutionId && totals
        ? [
            {
              reference: {kind: 'job-execution' as const, id: jobExecutionId},
              ...(durationSeconds === null || durationSeconds === undefined
                ? {}
                : {quantities: usageQuantitiesFromTotals(totals, durationSeconds)}),
            },
          ]
        : [],
    [durationSeconds, jobExecutionId, totals],
  );
  const costs = useUsageCosts(pricingInputs);
  const cost = jobExecutionId ? costs.get(`job-execution:${jobExecutionId}`) : undefined;

  if (!usage || !totals) return null;

  return (
    <span
      data-usage-job-cells
      className={`flex shrink-0 items-center gap-inline text-foreground-neutral-muted${className ? ` ${className}` : ''}`}
    >
      <Code as="span" variant="label" className="whitespace-nowrap text-current">
        {formatUsageDuration(durationSeconds)} compute
      </Code>
      <Code as="span" variant="label" className="whitespace-nowrap text-current">
        {formatUsageNumber(totals.totalTokens)} tokens
      </Code>
      <Code as="span" variant="label" className="whitespace-nowrap text-current">
        {formatUsageNumber(totals.requestCount)} requests
      </Code>
      <UsageCostBadge cost={cost} />
    </span>
  );
}
