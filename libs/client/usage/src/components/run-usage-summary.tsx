import {useUsagePricing} from '@shipfox/client-shell/runtime';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useMemo} from 'react';
import {type RunUsage, summarizeRunUsage} from '#core/usage.js';
import {useUsageCosts} from './usage-cost.js';
import {UsageCostBadge} from './usage-cost-badge.js';
import {formatUsageDuration, formatUsageNumber, usageQuantitiesFromTotals} from './usage-format.js';

export interface RunUsageSummaryProps {
  runId: string;
  usage: RunUsage | undefined;
  className?: string | undefined;
}

/** Compact quantities for the run header. Pricing is additive and never required for this view. */
export function RunUsageSummary({runId, usage, className}: RunUsageSummaryProps) {
  const pricing = useUsagePricing();
  const summary = useMemo(() => (usage ? summarizeRunUsage(usage) : undefined), [usage]);
  const pricingInputs = useMemo(
    () =>
      summary
        ? [
            {
              reference: {kind: 'run' as const, id: runId},
              quantities: usageQuantitiesFromTotals(summary.totals, summary.computeSeconds),
            },
          ]
        : [],
    [runId, summary],
  );
  const costs = useUsageCosts(pricingInputs);
  const cost = costs.get(`run:${runId}`);

  if (!summary) return null;

  return (
    <div
      data-usage-run-summary
      className={`flex min-w-0 flex-wrap items-center gap-inline text-xs text-foreground-neutral-subtle${className ? ` ${className}` : ''}`}
    >
      <span title="Total compute time">
        <Code as="span" variant="label" className="text-current">
          compute {formatUsageDuration(summary.computeSeconds)}
        </Code>
      </span>
      <span title="Total inference tokens">
        <Code as="span" variant="label" className="text-current">
          {formatUsageNumber(summary.totals.totalTokens)} tokens
        </Code>
      </span>
      <span title="Total inference requests">
        <Code as="span" variant="label" className="text-current">
          {formatUsageNumber(summary.totals.requestCount)} requests
        </Code>
      </span>
      {summary.byModel.map((model) => (
        <span key={model.model} className="max-w-200 truncate" title={`${model.model} tokens`}>
          <Text as="span" size="xs" className="text-current">
            <Code as="span" variant="label" className="text-current">
              {model.model}
            </Code>{' '}
            {formatUsageNumber(model.totalTokens)}
          </Text>
        </span>
      ))}
      <UsageCostBadge cost={cost} />
      {pricing && cost?.state === 'estimated' ? (
        <span className="sr-only">Estimated run cost</span>
      ) : null}
    </div>
  );
}
