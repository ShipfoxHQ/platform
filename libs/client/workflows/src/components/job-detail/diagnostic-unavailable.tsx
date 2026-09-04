import {Text} from '@shipfox/react-ui/typography';
import type {
  WorkflowDiagnosticField,
  WorkflowDiagnosticUnavailableReason,
} from '#core/workflow-run.js';
import {workflowPayloadFieldLabel} from '#core/workflow-run.js';

export function DiagnosticUnavailableField({
  field,
  storedBytes,
  reason,
}: {
  field: WorkflowDiagnosticField;
  storedBytes: number;
  reason: WorkflowDiagnosticUnavailableReason;
}) {
  const copy = diagnosticUnavailableCopy(reason);

  return (
    <div className="flex min-w-0 flex-col gap-tight rounded-6 border border-tag-warning-border bg-tag-warning-bg p-panel-compact">
      <Text size="xs" bold className="text-foreground-neutral-base">
        {workflowPayloadFieldLabel(field)} {copy.titleSuffix}
      </Text>
      <Text size="xs" className="text-tag-warning-text">
        {copy.description} Measured{' '}
        <span className="font-code">{storedBytes.toLocaleString()} bytes</span>.
      </Text>
    </div>
  );
}

export function DiagnosticUnavailableAnnouncement({count}: {count: number}) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {count} workflow detail {count === 1 ? 'is' : 'values are'} not available in full.
    </span>
  );
}

function diagnosticUnavailableCopy(reason: WorkflowDiagnosticUnavailableReason): {
  titleSuffix: string;
  description: string;
} {
  switch (reason) {
    case 'legacy_value_exceeds_inline_limit':
      return {
        titleSuffix: 'is unavailable in this view',
        description: 'The complete value exceeds the display limit and is not shown here.',
      };
    case 'value_exceeds_inline_limit':
      return {
        titleSuffix: 'exceeds the display limit',
        description:
          'The complete value is preserved for workflow execution but is not shown here.',
      };
    case 'value_truncated_at_write_limit':
      return {
        titleSuffix: 'was not fully recorded',
        description: 'Shipfox preserved the workflow outcome and omitted the oversized detail.',
      };
  }
}
