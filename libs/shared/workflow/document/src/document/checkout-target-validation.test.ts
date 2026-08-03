import {checkoutTargetValidationIssues} from './checkout-target-validation.js';

describe('checkoutTargetValidationIssues', () => {
  it('does not report a missing repository twice for a project conflict', () => {
    expect(checkoutTargetValidationIssues({project: 'project-id', connection: 'github'})).toEqual([
      {
        kind: 'project-with-connection',
        path: 'connection',
        fields: ['project', 'connection'],
      },
    ]);
  });
});
