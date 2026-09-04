export type WorkflowDiagnosticField =
  | 'authored_config'
  | 'config'
  | 'evaluation_trace'
  | 'output'
  | 'outputs'
  | 'response'
  | 'error'
  | 'gate_result'
  | 'restart_feedback'
  | 'job_outputs'
  | 'execution_outputs'
  | 'job_evaluation_trace'
  | 'execution_evaluation_trace'
  | 'condition'
  | 'trigger_events';

export type WorkflowPayloadField =
  | WorkflowDiagnosticField
  | 'resolved_config'
  | 'config_plan'
  | 'listener_batch';

const WORKFLOW_PAYLOAD_FIELD_LABELS = {
  authored_config: 'Authored configuration',
  config: 'Resolved configuration',
  resolved_config: 'Resolved configuration',
  config_plan: 'Configuration plan',
  evaluation_trace: 'Evaluation',
  job_evaluation_trace: 'Evaluation',
  execution_evaluation_trace: 'Evaluation',
  output: 'Step output',
  outputs: 'Outputs',
  response: 'Response',
  error: 'Failure details',
  gate_result: 'Gate result',
  restart_feedback: 'Restart feedback',
  job_outputs: 'Job outputs',
  execution_outputs: 'Execution outputs',
  condition: 'Condition',
  trigger_events: 'Trigger events',
  listener_batch: 'Trigger events',
} satisfies Record<WorkflowPayloadField, string>;

const CONFIGURATION_PAYLOAD_FIELDS = new Set<WorkflowPayloadField>([
  'authored_config',
  'config',
  'resolved_config',
  'config_plan',
  'condition',
]);

export function workflowPayloadFieldLabel(field: string | undefined): string {
  if (field === undefined || !(field in WORKFLOW_PAYLOAD_FIELD_LABELS)) return 'Workflow value';
  return WORKFLOW_PAYLOAD_FIELD_LABELS[field as WorkflowPayloadField];
}

export function isWorkflowConfigurationPayloadField(field: string | undefined): boolean {
  return field !== undefined && CONFIGURATION_PAYLOAD_FIELDS.has(field as WorkflowPayloadField);
}

export type WorkflowDiagnosticUnavailableReason =
  | 'legacy_value_exceeds_inline_limit'
  | 'value_exceeds_inline_limit'
  | 'value_truncated_at_write_limit';

export interface WorkflowDiagnosticUnavailableField {
  field: WorkflowDiagnosticField;
  storedBytes: number;
  reason: WorkflowDiagnosticUnavailableReason;
}
