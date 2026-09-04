import {useUsagePricing} from '@shipfox/client-shell/runtime';
import {Panel, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipfox/react-ui/table';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useMemo} from 'react';
import type {JobExecutionUsage} from '#core/usage.js';
import {groupInferenceSegmentsByStepAttempt} from '#core/usage.js';
import {useUsageCosts} from './usage-cost.js';
import {UsageCostBadge} from './usage-cost-badge.js';
import {formatUsageNumber, usageQuantitiesFromTotals} from './usage-format.js';

export interface StepInferenceTableProps {
  usage: JobExecutionUsage | undefined;
  stepLabels?: ReadonlyMap<string, string> | undefined;
  stepAttemptLabels?: ReadonlyMap<string, string> | undefined;
  className?: string | undefined;
}

/** Inference quantities grouped by step attempt, model, and upstream provider. */
export function StepInferenceTable({
  usage,
  stepLabels,
  stepAttemptLabels,
  className,
}: StepInferenceTableProps) {
  const pricing = useUsagePricing();
  const rows = useMemo(
    () => (usage ? groupInferenceSegmentsByStepAttempt(usage.inferenceSegments) : []),
    [usage],
  );
  const pricingInputs = useMemo(
    () =>
      rows.map((row) => ({
        reference: {kind: 'step-attempt' as const, id: row.stepAttemptId},
        quantities: usageQuantitiesFromTotals(row, 0),
      })),
    [rows],
  );
  const costs = useUsageCosts(pricingInputs);

  if (rows.length === 0) return null;

  const costByStepAttempt = new Set<string>();
  const showCosts = pricing !== undefined && costs.size > 0;
  return (
    <Panel
      aria-label="Inference usage by step"
      data-usage-step-inference-table
      className={className}
    >
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle>Inference usage</PanelTitle>
          <Text as="p" size="xs" className="mt-tight text-foreground-neutral-muted">
            Tokens recorded by step attempt, model, and provider.
          </Text>
        </div>
      </PanelHeader>
      <PanelBody className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Step attempt</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Input</TableHead>
              <TableHead className="text-right">Output</TableHead>
              <TableHead className="text-right">Total</TableHead>
              {showCosts ? <TableHead className="text-right">Cost</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const referenceKey = `step-attempt:${row.stepAttemptId}`;
              const showCostForRow = !costByStepAttempt.has(referenceKey);
              costByStepAttempt.add(referenceKey);
              const cost = showCostForRow ? costs.get(referenceKey) : undefined;
              return (
                <TableRow key={`${row.stepAttemptId}:${row.upstream}:${row.model}`}>
                  <TableCell>
                    <Text as="span" size="xs" className="block truncate">
                      {stepLabels?.get(row.stepId) ?? shortIdentifier(row.stepId)}
                    </Text>
                    <Code as="span" variant="label" className="text-foreground-neutral-muted">
                      attempt{' '}
                      {stepAttemptLabels?.get(row.stepAttemptId) ??
                        shortIdentifier(row.stepAttemptId)}
                    </Code>
                  </TableCell>
                  <TableCell>
                    <Code as="span" variant="label">
                      {row.upstream}
                    </Code>
                  </TableCell>
                  <TableCell>
                    <Code as="span" variant="label">
                      {row.model}
                    </Code>
                  </TableCell>
                  <TableCell className="text-right font-code tabular-nums">
                    {formatUsageNumber(row.requestCount)}
                  </TableCell>
                  <TableCell className="text-right font-code tabular-nums">
                    {formatUsageNumber(row.inputTokens)}
                  </TableCell>
                  <TableCell className="text-right font-code tabular-nums">
                    {formatUsageNumber(row.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right font-code tabular-nums">
                    {formatUsageNumber(row.totalTokens)}
                  </TableCell>
                  {showCosts ? (
                    <TableCell className="text-right">
                      <span className="inline-flex justify-end">
                        <UsageCostBadge cost={cost} />
                      </span>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </PanelBody>
    </Panel>
  );
}

function shortIdentifier(identifier: string): string {
  return identifier.slice(0, 8);
}
