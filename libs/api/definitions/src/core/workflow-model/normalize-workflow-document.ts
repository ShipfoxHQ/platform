import type {AgentValidationCatalog} from '@shipfox/api-agent-dto/inter-module';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import type {WorkflowDocument} from '@shipfox/workflow-document';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {WorkflowModel, WorkflowStepSourceLocationMap} from '../entities/workflow-model.js';
import {
  InvalidWorkflowModelError,
  type WorkflowModelValidationIssue,
} from './invalid-workflow-model-error.js';
import {mapJobIds} from './map-job-ids.js';
import {normalizeDependencies, validateCycles} from './normalize-dependencies.js';
import {normalizeEnv} from './normalize-env.js';
import {normalizeJobs} from './normalize-jobs.js';
import {normalizeTriggers} from './normalize-triggers.js';
import {parseInterpolationField} from './parse-interpolation-field.js';

export function normalizeWorkflowDocument(
  document: WorkflowDocument,
  options: {
    defaultRunnerLabels?: readonly string[] | undefined;
    agentValidationCatalog: AgentValidationCatalog;
    integrationValidationContext?: IntegrationValidationContext | undefined;
    stepSourceLocations?: WorkflowStepSourceLocationMap | undefined;
  },
): WorkflowModel {
  const issues: WorkflowModelValidationIssue[] = [];
  const defaultRunnerLabels = canonicalizeLabels(options.defaultRunnerLabels);
  const context = {
    defaultRunnerLabels,
    agentValidationCatalog: options.agentValidationCatalog,
    integrationValidationContext: options.integrationValidationContext,
  };
  const jobIdBySourceName = mapJobIds(document, issues);
  const triggers = normalizeTriggers(document, issues);
  const jobs = normalizeJobs(
    document,
    jobIdBySourceName,
    issues,
    options.stepSourceLocations,
    context,
  );
  const dependencies = normalizeDependencies(document.jobs, jobIdBySourceName, issues);
  const workflowEnv = normalizeEnv({env: document.env, path: ['env'], issues});
  const runName =
    document.run_name === undefined
      ? undefined
      : (parseInterpolationField({
          field: 'workflow.run_name',
          source: document.run_name,
          path: ['run_name'],
          issues,
          fillSite: 'run-creation',
        }) ?? [{kind: 'literal' as const, value: document.run_name}]);

  validateCycles(document.jobs, jobIdBySourceName, issues);

  if (issues.length > 0) {
    throw new InvalidWorkflowModelError(issues);
  }

  return {
    kind: 'workflow',
    name: document.name,
    ...(runName === undefined ? {} : {runName}),
    ...workflowEnv,
    triggers,
    jobs,
    dependencies,
  };
}
