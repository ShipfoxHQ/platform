import {Text} from '@shipfox/react-ui/typography';
import type {WorkflowDiagnosticField} from '#core/workflow-run.js';

export function DiagnosticUnavailableField({
  field,
  storedBytes,
}: {
  field: WorkflowDiagnosticField;
  storedBytes: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-tight rounded-6 border border-tag-warning-border bg-tag-warning-bg p-panel-compact">
      <Text size="xs" bold className="text-foreground-neutral-base">
        {diagnosticFieldLabel(field)} unavailable
      </Text>
      <Text size="xs" className="text-tag-warning-text">
        The stored value is too large to display ({storedBytes.toLocaleString()} bytes).
      </Text>
    </div>
  );
}

export function DiagnosticUnavailableAnnouncement({count}: {count: number}) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {count} diagnostic {count === 1 ? 'field is' : 'fields are'} unavailable because the stored
      value{count === 1 ? ' is' : 's are'} too large to display.
    </span>
  );
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
    case 'filter_snapshot':
      return 'Listener filter snapshot';
  }
}
