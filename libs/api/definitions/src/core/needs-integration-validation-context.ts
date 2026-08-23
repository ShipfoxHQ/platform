import type {WorkflowDocument} from '@shipfox/workflow-document';

/**
 * Whether the document needs the integration validation context (connection
 * snapshot and provider event catalogs) to validate its triggers: any trigger,
 * listening `on` / `until` matcher, or agent-step integration. The manual and
 * cron checks are literal and context-free, but loading the context for every
 * trigger document keeps the gate simple and the slug checks uniform.
 */
export function needsIntegrationValidationContext(document: WorkflowDocument): boolean {
  if (Object.keys(document.triggers ?? {}).length > 0) return true;

  return Object.values(document.jobs).some(
    (job) =>
      job.listening !== undefined || job.steps.some((step) => step.integrations !== undefined),
  );
}
