import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {evaluatePlannedPredicateAtSite} from './evaluate-planned-predicate.js';

function expression(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

describe('evaluatePlannedPredicateAtSite', () => {
  it('delegates available predicates to fail-closed evaluation', () => {
    const passed = evaluatePlannedPredicateAtSite({
      expression: expression('step.exit_code == 0'),
      field: 'step.success',
      site: 'step-report',
      context: {step: {exit_code: 0}},
    });
    const failed = evaluatePlannedPredicateAtSite({
      expression: expression('step.exit_code == 0'),
      field: 'step.success',
      site: 'step-report',
      context: {step: {exit_code: 1}},
    });

    expect(passed).toEqual({
      value: true,
      evaluationFailed: false,
      route: {roots: ['step'], runnerRoots: [], fillTarget: 'step-report'},
    });
    expect(failed).toEqual({
      value: false,
      evaluationFailed: false,
      route: {roots: ['step'], runnerRoots: [], fillTarget: 'step-report'},
    });
  });

  it('fails closed when available predicate evaluation throws', () => {
    const result = evaluatePlannedPredicateAtSite({
      expression: expression('step.missing == 0'),
      field: 'step.success',
      site: 'step-report',
      context: {step: {}},
    });

    expect(result).toEqual({
      value: false,
      evaluationFailed: true,
      route: {roots: ['step'], runnerRoots: [], fillTarget: 'step-report'},
    });
  });

  it('fails closed when runtime context contains no roots accepted by the field', () => {
    const result = evaluatePlannedPredicateAtSite({
      expression: expression('jobs.build.status == "succeeded"'),
      field: 'step.success',
      site: 'step-report',
      context: {jobs: {build: {status: 'succeeded'}}},
    });

    expect(result).toEqual({
      value: false,
      evaluationFailed: true,
      route: {roots: ['jobs'], runnerRoots: [], fillTarget: 'step-report'},
    });
  });

  it('fails closed when the predicate needs a later server fill site', () => {
    const result = evaluatePlannedPredicateAtSite({
      expression: expression('executions.all(e, e.status == "succeeded")'),
      field: 'job.success',
      site: 'run-creation',
      context: {executions: []},
    });

    expect(result).toEqual({
      value: false,
      evaluationFailed: true,
      route: {roots: ['executions'], runnerRoots: [], fillTarget: 'job-resolution'},
    });
  });

  it('uses predicate field minimum fill targets for rootless if predicates', () => {
    const jobIf = evaluatePlannedPredicateAtSite({
      expression: expression('true'),
      field: 'job.if',
      site: 'run-creation',
      context: {},
    });
    const stepIf = evaluatePlannedPredicateAtSite({
      expression: expression('true'),
      field: 'step.if',
      site: 'job-activation',
      context: {},
    });

    expect(jobIf).toEqual({
      value: false,
      evaluationFailed: true,
      route: {roots: [], runnerRoots: [], fillTarget: 'job-activation'},
    });
    expect(stepIf).toEqual({
      value: false,
      evaluationFailed: true,
      route: {roots: [], runnerRoots: [], fillTarget: 'step-dispatch'},
    });
  });

  it('fails closed for runner-fill predicates', () => {
    const result = evaluatePlannedPredicateAtSite({
      expression: expression('runner.os == "linux"'),
      field: 'job.success',
      site: 'job-resolution',
      context: {runner: {os: 'linux'}},
    });

    expect(result).toEqual({
      value: false,
      evaluationFailed: true,
      route: {roots: ['runner'], runnerRoots: ['runner'], fillTarget: 'runner-fill'},
    });
  });
});
