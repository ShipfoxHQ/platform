import type {WorkflowDocument} from '@shipfox/workflow-document';
import {hasIntegrationToolReferences} from './has-integration-tool-references.js';

/**
 * Whether the document needs the integration validation context (connection
 * snapshot and provider event catalogs) to validate an integration-source
 * trigger, listening matcher, agent-step integration, or tool step. The manual
 * and cron checks are literal and context-free.
 */
export function needsIntegrationValidationContext(document: WorkflowDocument): boolean {
  const topLevelTriggers = Object.values(document.triggers ?? {});
  if (topLevelTriggers.some(isIntegrationTrigger)) return true;

  return (
    hasIntegrationToolReferences(document) ||
    Object.values(document.jobs).some(
      (job) =>
        job.listening?.on.some(isIntegrationTrigger) === true ||
        job.listening?.until?.some(isIntegrationTrigger) === true,
    )
  );
}

function isIntegrationTrigger(trigger: {source: string}): boolean {
  return trigger.source !== 'manual' && trigger.source !== 'cron';
}
