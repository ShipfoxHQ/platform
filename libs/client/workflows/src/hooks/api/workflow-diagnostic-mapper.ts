import type {OversizedFieldDto} from '@shipfox/api-workflows-dto';
import type {WorkflowDiagnosticUnavailableField} from '#core/workflow-run.js';

export function toWorkflowDiagnosticUnavailableField(
  dto: OversizedFieldDto,
): WorkflowDiagnosticUnavailableField {
  return {
    field: dto.field,
    storedBytes: dto.stored_bytes,
    reason: dto.reason,
  };
}
