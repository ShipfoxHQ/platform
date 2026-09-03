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

export interface WorkflowDiagnosticUnavailableField {
  field: WorkflowDiagnosticField;
  storedBytes: number;
  reason: 'legacy_value_exceeds_inline_limit';
}
