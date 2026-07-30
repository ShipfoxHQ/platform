import {extractCelUntrustedPathAccesses} from './extract-cel-untrusted-path-accesses.js';

const untrustedPathsByRoot = new Map<string, readonly string[]>([
  ['execution', ['events']],
  ['executions', ['events']],
  ['steps', ['outputs']],
]);

function extract(source: string): string[] {
  return extractCelUntrustedPathAccesses({source, untrustedPathsByRoot});
}

describe('extractCelUntrustedPathAccesses', () => {
  it.each([
    ['execution.events[0].data', ['execution']],
    ['execution["events"][0].data', ['execution']],
    ['executions[0].events', ['executions']],
    ['executions[0]["events"]', ['executions']],
    ['execution.events.exists(e, e.data.ok)', ['execution']],
    ['executions.map(e, e.events[0].data.body)', ['executions']],
    ['executions.exists(e, e.events.size() > 0)', ['executions']],
    ['steps.filter(s, true).map(s, s.outputs.value)[0]', ['steps']],
  ] as const)('finds untrusted path access in %s', (source, roots) => {
    const result = extract(source);

    expect(result).toEqual(roots);
  });

  it.each([
    'execution.name',
    'executions[0].name',
    'run.id',
    'execution.events_count',
  ])('ignores trusted path access in %s', (source) => {
    const result = extract(source);

    expect(result).toEqual([]);
  });

  it('conservatively treats computed object fields as untrusted path access', () => {
    expect(extract('execution[x]')).toEqual(['execution']);
    expect(extract('executions[i][x]')).toEqual(['executions']);
  });

  it('allows computed list indexes on executions', () => {
    const result = extract('executions[i].name');

    expect(result).toEqual([]);
  });
});
