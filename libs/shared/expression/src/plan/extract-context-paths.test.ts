import {analyzeContextPathAccess} from './extract-context-paths.js';

describe('analyzeContextPathAccess', () => {
  it('extracts exact nested and indexed paths', () => {
    const source =
      'jobs.remember.outputs.pr_number == 42 && jobs.remember.executions[0].status == "succeeded"';

    expect(analyzeContextPathAccess(source, ['jobs'])).toEqual({
      references: [
        {
          root: 'jobs',
          segments: ['remember', 'outputs', 'pr_number'],
          source: 'jobs.remember.outputs.pr_number',
        },
        {
          root: 'jobs',
          segments: ['remember', 'executions', 0, 'status'],
          source: 'jobs.remember.executions[0].status',
        },
      ],
      unknown: [],
    });
  });

  it('treats literal string indexes as exact paths', () => {
    expect(analyzeContextPathAccess('jobs["remember"].outputs.pr_number', ['jobs'])).toEqual({
      references: [
        {
          root: 'jobs',
          segments: ['remember', 'outputs', 'pr_number'],
          source: 'jobs["remember"].outputs.pr_number',
        },
      ],
      unknown: [],
    });
  });

  it('reports dynamic access explicitly instead of treating it as exact', () => {
    expect(analyzeContextPathAccess('jobs[inputs.target].outputs.pr_number', ['jobs'])).toEqual({
      references: [],
      unknown: [
        {
          root: 'jobs',
          source: 'jobs[inputs.target].outputs.pr_number',
          reason: 'dynamic',
        },
      ],
    });

    expect(analyzeContextPathAccess('jobs[inputs.target].outputs.pr_number')).toEqual({
      references: [{root: 'inputs', segments: ['target'], source: 'inputs.target'}],
      unknown: [
        {
          root: 'jobs',
          source: 'jobs[inputs.target].outputs.pr_number',
          reason: 'dynamic',
        },
      ],
    });
  });

  it('keeps comprehension aliases on their source collection path', () => {
    expect(
      analyzeContextPathAccess('jobs.remember.executions.map(e, e.outputs.pr_number)', ['jobs']),
    ).toEqual({
      references: [
        {
          root: 'jobs',
          segments: ['remember', 'executions', '*'],
          source: 'jobs.remember.executions',
        },
        {
          root: 'jobs',
          segments: ['remember', 'executions', '*', 'outputs', 'pr_number'],
          source: 'e.outputs.pr_number',
        },
      ],
      unknown: [],
    });
  });

  it('supports nested historical event paths for future audits', () => {
    const source = 'executions.map(e, e.trigger_events.map(event, event.data.action))';

    expect(analyzeContextPathAccess(source)).toEqual({
      references: [
        {root: 'executions', segments: ['*'], source: 'executions'},
        {
          root: 'executions',
          segments: ['*', 'trigger_events', '*'],
          source: 'e.trigger_events',
        },
        {
          root: 'executions',
          segments: ['*', 'trigger_events', '*', 'data', 'action'],
          source: 'event.data.action',
        },
      ],
      unknown: [],
    });
  });

  it('represents broad root access as an empty known path', () => {
    expect(analyzeContextPathAccess('jobs', ['jobs'])).toEqual({
      references: [{root: 'jobs', segments: [], source: 'jobs'}],
      unknown: [],
    });
  });

  it('keeps selected roots referenced by dynamic index dependencies', () => {
    expect(analyzeContextPathAccess('inputs[jobs.target]', ['jobs'])).toEqual({
      references: [{root: 'jobs', segments: ['target'], source: 'jobs.target'}],
      unknown: [],
    });
  });

  it('propagates paths through chained comprehensions', () => {
    expect(
      analyzeContextPathAccess(
        'jobs.build.executions.filter(e, e.status == "failed").exists(x, x.outputs.pr_number == 42)',
        ['jobs'],
      ),
    ).toEqual({
      references: [
        {root: 'jobs', segments: ['build', 'executions', '*'], source: 'jobs.build.executions'},
        {
          root: 'jobs',
          segments: ['build', 'executions', '*', 'status'],
          source: 'e.status',
        },
        {
          root: 'jobs',
          segments: ['build', 'executions', '*', 'outputs', 'pr_number'],
          source: 'x.outputs.pr_number',
        },
      ],
      unknown: [],
    });
  });
});
