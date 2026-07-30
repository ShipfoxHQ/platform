import {DEFAULT_JOB_CHECKOUT, type WorkflowModelJobCheckout} from '@shipfox/api-definitions-dto';
import type {WorkflowDocumentJob} from '@shipfox/workflow-document';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

export {DEFAULT_JOB_CHECKOUT};

export function normalizeJobCheckout(params: {
  checkout: WorkflowDocumentJob['checkout'];
  issues: WorkflowModelValidationIssue[];
  path: readonly (string | number)[];
}): WorkflowModelJobCheckout {
  if (params.checkout === false) {
    params.issues.push(
      issue({
        code: 'unsupported-checkout',
        message: 'checkout: false is not supported by the workflow model yet.',
        path: params.path,
      }),
    );
  }

  const checkout = params.checkout === false ? undefined : params.checkout;
  return {
    permissions: {
      contents: checkout?.permissions?.contents ?? DEFAULT_JOB_CHECKOUT.permissions.contents,
    },
    persistCredentials:
      checkout?.['persist-credentials'] ?? DEFAULT_JOB_CHECKOUT.persistCredentials,
  };
}
