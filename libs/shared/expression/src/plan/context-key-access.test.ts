import {analyzeContextKeyAccess, analyzeContextRootKeyAccess} from './context-key-access.js';

describe('analyzeContextKeyAccess', () => {
  it('returns canonical references for vars and secrets', () => {
    const result = analyzeContextKeyAccess('vars.REGION + secrets.local.TOKEN + secrets.API_KEY');

    expect(result).toEqual({
      references: [
        {root: 'vars', key: 'REGION'},
        {root: 'secrets', store: 'local', key: 'TOKEN'},
        {root: 'secrets', key: 'API_KEY'},
      ],
      violations: [],
    });
  });

  it('allows literal-key values to be used inside larger expressions', () => {
    const result = analyzeContextKeyAccess('"eu-" + vars.REGION');

    expect(result).toEqual({
      references: [{root: 'vars', key: 'REGION'}],
      violations: [],
    });
  });

  it.each([
    'vars[event.name]',
    'vars["REGION"]',
    'vars',
  ])('rejects non-literal vars key access: %s', (source) => {
    const result = analyzeContextKeyAccess(source);

    expect(result.violations).toEqual([{root: 'vars', source}]);
  });

  it('rejects non-literal secret key access', () => {
    const result = analyzeContextKeyAccess('secrets[event.name]');

    expect(result.violations).toEqual([{root: 'secrets', source: 'secrets[event.name]'}]);
  });

  it('does not treat comprehension aliases as context roots', () => {
    const result = analyzeContextKeyAccess('executions.all(vars, vars.status == "succeeded")');

    expect(result).toEqual({references: [], violations: []});
  });

  it('does not treat map literal identifier keys as context roots', () => {
    const result = analyzeContextKeyAccess('{vars: event.region, secrets: event.token}');

    expect(result).toEqual({references: [], violations: []});
  });
});

describe('analyzeContextRootKeyAccess', () => {
  it('returns first literal keys for selected roots', () => {
    const result = analyzeContextRootKeyAccess(
      'jobs.build.outputs.sha + jobs.review.executions.map(e, e.outputs.verdict).join(",")',
      ['jobs'],
    );

    expect(result).toEqual({
      references: [
        {root: 'jobs', key: 'build'},
        {root: 'jobs', key: 'review'},
      ],
      violations: [],
    });
  });

  it.each([
    'jobs',
    'jobs[event.name]',
    'jobs["build"]',
  ])('reports non-dot-key root access: %s', (source) => {
    const result = analyzeContextRootKeyAccess(source, ['jobs']);

    expect(result).toEqual({
      references: [],
      violations: [
        source === 'jobs["build"]' ? {root: 'jobs', key: 'build', source} : {root: 'jobs', source},
      ],
    });
  });

  it('does not treat comprehension aliases as selected roots', () => {
    const result = analyzeContextRootKeyAccess('jobs.review.executions.map(jobs, jobs.status)', [
      'jobs',
    ]);

    expect(result).toEqual({
      references: [{root: 'jobs', key: 'review'}],
      violations: [],
    });
  });
});
