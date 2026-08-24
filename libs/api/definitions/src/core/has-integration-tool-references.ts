import type {WorkflowDocument} from '@shipfox/workflow-document';

/**
 * Whether the document references integration tools: agent-step
 * `integrations:` selectors or tool steps. True for any tool step, even one
 * that does not name a connection, because the tool itself must be validated
 * against the provider catalog at sync time.
 */
export function hasIntegrationToolReferences(document: WorkflowDocument): boolean {
  return Object.values(document.jobs).some((job) =>
    job.steps.some((step) => step.tool !== undefined || step.integrations !== undefined),
  );
}
