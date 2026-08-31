import {
  DEFAULT_JOB_CHECKOUT,
  WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS,
  type WorkflowFieldTemplate,
  type WorkflowModelCheckout,
  type WorkflowModelCheckoutTargetKey,
  type WorkflowModelJobCheckout,
} from '@shipfox/api-definitions-dto';
import type {AvailabilitySite, ExpressionTypeEnvironment} from '@shipfox/expression';
import {
  checkoutTargetValidationIssues,
  type WorkflowDocumentCheckout,
  type WorkflowDocumentJob,
} from '@shipfox/workflow-document';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {parseInterpolationField} from './parse-interpolation-field.js';
import {issue} from './validation-issue.js';

export {DEFAULT_JOB_CHECKOUT};

const DEFAULT_CHECKOUT_FETCH_DEPTH = 1;

function normalizeCheckoutTemplates(params: Parameters<typeof normalizeCheckout>[0]) {
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
    if (template !== undefined) templates[key] = template;
  }
  return Object.keys(templates).length === 0 ? undefined : templates;
}

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
  const normalized: {-readonly [Key in keyof WorkflowModelCheckout]: WorkflowModelCheckout[Key]} = {
    fetchDepth: params.checkout['fetch-depth'] ?? DEFAULT_CHECKOUT_FETCH_DEPTH,
    permissions: {
      contents: params.checkout.permissions?.contents ?? DEFAULT_JOB_CHECKOUT.permissions.contents,
    },
    persistCredentials:
      params.checkout['persist-credentials'] ?? DEFAULT_JOB_CHECKOUT.persistCredentials,
  };
  if (params.checkout.project !== undefined) normalized.project = params.checkout.project;
  if (params.checkout.connection !== undefined) normalized.connection = params.checkout.connection;
  if (params.checkout.repository !== undefined) normalized.repository = params.checkout.repository;
  if (params.checkout.ref !== undefined) normalized.ref = params.checkout.ref;
  if (params.checkout.path !== undefined) normalized.path = params.checkout.path;
  if (params.checkout.force !== undefined) normalized.force = params.checkout.force;
  const templates = normalizeCheckoutTemplates(params);
  if (templates !== undefined) normalized.templates = templates;

  return normalized;
}

function validateCheckoutTargetShape(params: {
  checkout: WorkflowDocumentCheckout;
  issues: WorkflowModelValidationIssue[];
  path: readonly WorkflowModelValidationIssuePathSegment[];
}): void {
  for (const validationIssue of checkoutTargetValidationIssues(params.checkout)) {
    let message = 'Checkout target "connection" requires "repository".';
    if (validationIssue.kind === 'project-with-connection') {
      message = 'Checkout target "connection" cannot be combined with "project".';
    } else if (validationIssue.kind === 'project-with-repository') {
      message = 'Checkout target "repository" cannot be combined with "project".';
    }
    params.issues.push(
      issue({
        code: 'checkout-target-invalid',
        message,
        path: [...params.path, validationIssue.path],
        details: {fields: validationIssue.fields},
      }),
    );
  }
}
