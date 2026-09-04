import {Text} from '@shipfox/react-ui/typography';
import type {
  WorkflowDiagnosticField,
  WorkflowDiagnosticUnavailableReason,
} from '#core/workflow-run.js';

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
        {diagnosticFieldLabel(field)} {copy.titleSuffix}
      </Text>
      <Text size="xs" className="text-tag-warning-text">
        {copy.description} Measured {storedBytes.toLocaleString()} bytes.
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
        description: 'This value was recorded by an older server and exceeds the display limit.',
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

export function diagnosticFieldLabel(field: WorkflowDiagnosticField): string {
  switch (field) {
    case 'authored_config':
      return 'Authored configuration';
    case 'config':
      return 'Resolved configuration';
    case 'evaluation_trace':
    case 'job_evaluation_trace':
    case 'execution_evaluation_trace':
      return 'Evaluation';
    case 'output':
      return 'Step output';
    case 'outputs':
      return 'Outputs';
    case 'response':
      return 'Response';
    case 'error':
      return 'Failure details';
    case 'gate_result':
      return 'Gate result';
    case 'restart_feedback':
      return 'Restart feedback';
    case 'job_outputs':
      return 'Job outputs';
    case 'execution_outputs':
      return 'Execution outputs';
    case 'condition':
      return 'Condition';
    case 'trigger_events':
      return 'Trigger events';
  }
}
