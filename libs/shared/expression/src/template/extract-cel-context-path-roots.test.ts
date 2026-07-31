import {extractCelContextPathRoots} from './extract-cel-context-path-roots.js';

const pathsByRoot = new Map<string, readonly string[]>([
  ['execution', ['events', 'outputs']],
  ['executions', ['events', 'outputs']],
  ['steps', ['outputs']],
  ['step', ['outputs']],
]);

function extract(source: string): string[] {
  return extractCelContextPathRoots({source, pathsByRoot});
}

describe('extractCelContextPathRoots', () => {
  it.each([
    ['execution.events[0].data', ['execution']],
    ['execution["events"][0].data', ['execution']],
    ['execution.outputs.value', ['execution']],
    ['executions[0].events', ['executions']],
    ['executions[0]["events"]', ['executions']],
    ['executions[0].outputs.value', ['executions']],
    ['execution.events.exists(e, e.data.ok)', ['execution']],
    ['executions.map(e, e.events[0].data.body)', ['executions']],
    ['executions.exists(e, e.events.size() > 0)', ['executions']],
    ['executions.exists(e, e[job.key] == "gpu-flag")', ['executions']],
    ['cel.bind(e, executions, e.events[0].data.body)', ['executions']],
    ['cel.bind(e, executions, e[job.key])', ['executions']],
    ['steps.filter(s, true).map(s, s.outputs.value)[0]', ['steps']],
    ['step.outputs.value', ['step']],
  ] as const)('finds configured path access in %s', (source, roots) => {
    expect(extract(source)).toEqual(roots);
  });

  it.each([
    'execution.name',
    'executions[0].name',
    'run.id',
    'execution.events_count',
  ])('ignores other paths in %s', (source) => {
    expect(extract(source)).toEqual([]);
  });

  it('conservatively treats computed object fields as configured path access', () => {
    expect(extract('execution[x]')).toEqual(['execution']);
    expect(extract('executions[i][x]')).toEqual(['executions']);
  });

  it.each([
    'dyn(execution).events[0].data',
    '(true ? execution : execution).events[0].data',
    '[execution][0].events[0].data',
    '{x: execution}.x.events[0].data',
  ])('fails closed for wrapped configured paths in %s', (source) => {
    expect(extract(source)).toEqual(['execution']);
  });

  it('allows computed list indexes on executions', () => {
    expect(extract('executions[i].name')).toEqual([]);
  });
});
