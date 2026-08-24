import type {WorkflowDocument} from '@shipfox/workflow-document';

/**
 * Whether the document needs the integration validation context (connection
 * snapshot and provider event catalogs) to validate an integration-source
 * trigger, listening matcher, agent-step integration, or tool step. The manual
 * and cron checks are literal and context-free.
 */
export function needsIntegrationValidationContext(document: WorkflowDocument): boolean {
  const topLevelTriggers = Object.values(document.triggers ?? {});
  if (topLevelTriggers.some(isIntegrationTrigger)) return true;

  return Object.values(document.jobs).some(
    (job) =>
      job.listening?.on.some(isIntegrationTrigger) === true ||
      job.listening?.until?.some(isIntegrationTrigger) === true ||
      job.steps.some((step) => step.integrations !== undefined || step.tool !== undefined),
  );
}

function isIntegrationTrigger(trigger: {source: string}): boolean {
  return trigger.source !== 'manual' && trigger.source !== 'cron';
}
