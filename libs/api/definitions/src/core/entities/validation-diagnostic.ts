export type ValidationDiagnosticSeverity = 'error' | 'warning';

export interface ValidationDiagnostic {
  code: string;
  message: string;
  path?: string | undefined;
  severity: ValidationDiagnosticSeverity;
}
