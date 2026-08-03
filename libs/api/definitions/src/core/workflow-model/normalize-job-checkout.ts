import {
  DEFAULT_JOB_CHECKOUT,
  WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS,
  type WorkflowFieldTemplate,
  type WorkflowModelCheckout,
  type WorkflowModelCheckoutTargetKey,
  type WorkflowModelJobCheckout,
} from '@shipfox/api-definitions-dto';
import type {AvailabilitySite, ExpressionTypeEnvironment} from '@shipfox/expression';
import type {WorkflowDocumentCheckout, WorkflowDocumentJob} from '@shipfox/workflow-document';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {parseInterpolationField} from './parse-interpolation-field.js';
import {issue} from './validation-issue.js';

export {DEFAULT_JOB_CHECKOUT};

const DEFAULT_CHECKOUT_FETCH_DEPTH = 1;

export function normalizeJobCheckout(params: {
  checkout: WorkflowDocumentJob['checkout'];
}): WorkflowModelJobCheckout | false {
  if (params.checkout === false) {
    return false;
  }

  const checkout = params.checkout ?? {};
  return {
    permissions: {
      contents: checkout.permissions?.contents ?? DEFAULT_JOB_CHECKOUT.permissions.contents,
    },
    persistCredentials: checkout['persist-credentials'] ?? DEFAULT_JOB_CHECKOUT.persistCredentials,
  };
}

export function normalizeCheckout(params: {
  checkout: WorkflowDocumentCheckout;
  issues: WorkflowModelValidationIssue[];
  path: readonly WorkflowModelValidationIssuePathSegment[];
  fillSite: AvailabilitySite;
  allowedJobReferences?: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowModelCheckout {
  validateCheckoutTargetShape(params);

  const templates: Partial<Record<WorkflowModelCheckoutTargetKey, WorkflowFieldTemplate>> = {};
  for (const [key, field] of WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS) {
    const source = params.checkout[key];
    if (source === undefined) continue;

    const template = parseInterpolationField({
      field,
      source,
      path: [...params.path, key],
      issues: params.issues,
      fillSite: params.fillSite,
      ...(params.allowedJobReferences === undefined
        ? {}
        : {allowedJobReferences: params.allowedJobReferences}),
      ...(params.typeOverlay === undefined ? {} : {typeOverlay: params.typeOverlay}),
    });
    if (template === undefined) continue;

    templates[key] = template;
  }

  const normalized = {
    ...(params.checkout.project === undefined ? {} : {project: params.checkout.project}),
    ...(params.checkout.connection === undefined ? {} : {connection: params.checkout.connection}),
    ...(params.checkout.repository === undefined ? {} : {repository: params.checkout.repository}),
    ...(params.checkout.ref === undefined ? {} : {ref: params.checkout.ref}),
    fetchDepth: params.checkout['fetch-depth'] ?? DEFAULT_CHECKOUT_FETCH_DEPTH,
    ...(params.checkout.path === undefined ? {} : {path: params.checkout.path}),
    permissions: {
      contents: params.checkout.permissions?.contents ?? DEFAULT_JOB_CHECKOUT.permissions.contents,
    },
    persistCredentials:
      params.checkout['persist-credentials'] ?? DEFAULT_JOB_CHECKOUT.persistCredentials,
    ...(params.checkout.force === undefined ? {} : {force: params.checkout.force}),
    ...(Object.keys(templates).length === 0 ? {} : {templates}),
  } satisfies WorkflowModelCheckout;

  return normalized;
}

function validateCheckoutTargetShape(params: {
  checkout: WorkflowDocumentCheckout;
  issues: WorkflowModelValidationIssue[];
  path: readonly WorkflowModelValidationIssuePathSegment[];
}): void {
  if (params.checkout.project !== undefined && params.checkout.connection !== undefined) {
    params.issues.push(
      issue({
        code: 'checkout-target-invalid',
        message: 'Checkout target "connection" cannot be combined with "project".',
        path: [...params.path, 'connection'],
        details: {fields: ['project', 'connection']},
      }),
    );
  }

  if (params.checkout.project !== undefined && params.checkout.repository !== undefined) {
    params.issues.push(
      issue({
        code: 'checkout-target-invalid',
        message: 'Checkout target "repository" cannot be combined with "project".',
        path: [...params.path, 'repository'],
        details: {fields: ['project', 'repository']},
      }),
    );
  }
}
