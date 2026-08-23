import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {validateDefinition as validateDefinitionBase} from './validate-definition.js';

function validateDefinition(yaml: string, options = {}) {
  return validateDefinitionBase(yaml, {agentValidationCatalog, ...options});
}

function interpolation(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

describe('validateDefinition', () => {
  test('valid YAML returns { valid: true, definition }', () => {
    const yaml = `
name: Test
runner: ubuntu-latest
jobs:
  build:
    steps:
      - run: echo hello
`;

    const result = validateDefinition(yaml);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.diagnostics).toEqual([]);
      expect(result.definition.document.name).toBe('Test');
      expect(result.definition.document.jobs.build?.steps).toHaveLength(1);
      expect(result.definition.model.jobs[0]?.id).toBe('build');
    }
  });

  test('invalid YAML syntax returns { valid: false, errors }', () => {
    const result = validateDefinition('name: Bad\n  invalid:\nindentation');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result).not.toHaveProperty('diagnostics');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain('Invalid workflow YAML syntax');
    }
  });

  test('non-object YAML returns { valid: false, errors }', () => {
    const stringResult = validateDefinition('just a string');
    expect(stringResult.valid).toBe(false);

    const nullResult = validateDefinition('');
    expect(nullResult.valid).toBe(false);

    const arrayResult = validateDefinition('- item1\n- item2');
    expect(arrayResult.valid).toBe(false);
  });

  test('invalid document returns { valid: false, errors with details }', () => {
    const yaml = `
jobs:
  build:
    steps:
      - run: echo hello
`;

    const result = validateDefinition(yaml);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toBeDefined();
    }
  });

  test('cyclic DAG returns { valid: false, errors with cycle info }', () => {
    const yaml = `
name: Cyclic
runner: ubuntu-latest
jobs:
  a:
    needs: b
    steps:
      - run: echo a
  b:
    needs: a
    steps:
      - run: echo b
`;

    const result = validateDefinition(yaml);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.message).toContain('Circular dependency');
    }
  });

  test('runner-less YAML returns a validation path for the missing runner', () => {
    const yaml = `
name: Missing runner
jobs:
  build:
    steps:
      - run: echo hello
`;

    const result = validateDefinition(yaml);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual(expect.objectContaining({path: 'jobs.build.runner'}));
    }
  });

  test('default runner labels allow runner-less YAML', () => {
    const yaml = `
name: Default runner
jobs:
  build:
    steps:
      - run: echo hello
`;

    const result = validateDefinition(yaml, {defaultRunnerLabels: ['ubuntu-latest']});

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.definition.model.jobs[0]?.runner).toEqual(['ubuntu-latest']);
    }
  });

  test.each([
    [
      'an env binding',
      'MSG',
      `
name: Re-evaluating command
runner: ubuntu-latest
jobs:
  build:
    steps:
      - env:
          MSG: '${interpolation('event.x')}'
        run: eval "$MSG"
`,
    ],
    [
      'a hoisted interpolation',
      '__sf_0',
      `
name: Re-evaluating command
runner: ubuntu-latest
jobs:
  build:
    steps:
      - run: 'eval "${interpolation('event.x')}"'
`,
    ],
  ] as const)('returns one non-fatal warning for %s', (_description, valueName, yaml) => {
    const result = validateDefinition(yaml);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        code: 're-evaluating-command',
        path: 'jobs.build.steps.0.run',
        severity: 'warning',
      });
      expect(result.diagnostics[0]?.message).toContain(`$${valueName}`);
      expect(result.diagnostics[0]?.message).toContain('eval');
      expect(result.diagnostics[0]?.message).toContain('re-executed as code');
      expect(result.definition.model.jobs[0]?.steps).toHaveLength(1);
    }
  });

  test.each([
    'eval "$(cat script.sh)"',
    "sh -c 'echo fixed'",
    'source ./scripts/setup.sh',
    'xargs cmd "$MSG"',
  ])('does not warn for the common data-safe form %s', (run) => {
    const result = validateDefinition(`
name: Safe command
runner: ubuntu-latest
jobs:
  build:
    steps:
      - env:
          MSG: fixed
        run: |
          ${run}
`);

    expect(result).toMatchObject({valid: true, diagnostics: []});
  });

  test.each([
    ['command substitution', `echo $(${interpolation('event.ref')})`, 'command substitution'],
    ['backtick substitution', `echo \`${interpolation('event.ref')}\``, 'backtick substitution'],
    ['arithmetic expansion', `echo $(( ${interpolation('event.ref')} + 1 ))`, 'shell arithmetic'],
  ])('warns for interpolation inside %s', (_description, run, construct) => {
    const result = validateDefinition(`
name: Unsafe interpolation
runner: ubuntu-latest
jobs:
  build:
    steps:
      - run: |
          ${run}
`);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        code: 're-evaluating-command',
        path: 'jobs.build.steps.0.run',
        severity: 'warning',
      });
      expect(result.diagnostics[0]?.message).toContain('event.ref');
      expect(result.diagnostics[0]?.message).toContain(construct);
    }
  });

  test('warns for every repeated and unsafe flagged position', () => {
    const result = validateDefinition(`
name: Multiple re-evaluating commands
runner: ubuntu-latest
jobs:
  build:
    steps:
      - env:
          MSG: fixed
        run: |
          eval "$MSG" "$MSG"; echo $(${interpolation('event.first')}); eval "$MSG"; echo $((1 + ${interpolation('event.second')}))
`);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.diagnostics).toHaveLength(5);
      expect(
        result.diagnostics.every((diagnostic) => diagnostic.code === 're-evaluating-command'),
      ).toBe(true);
      expect(
        result.diagnostics.every((diagnostic) => diagnostic.path === 'jobs.build.steps.0.run'),
      ).toBe(true);
      expect(result.diagnostics.every((diagnostic) => diagnostic.severity === 'warning')).toBe(
        true,
      );
      expect(
        result.diagnostics.filter((diagnostic) => diagnostic.message.includes('eval')),
      ).toHaveLength(3);
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.message.includes('event.first')),
      ).toBe(true);
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.message.includes('event.second')),
      ).toBe(true);
    }
  });

  test('disabled Pi search tools return precise definition validation paths', () => {
    const yaml = `
name: Pi tools
runner: ubuntu-latest
jobs:
  inspect:
    steps:
      - harness: pi
        prompt: Fetch without search.
        tools: [fetch_content, web_search, get_search_content]
`;

    const result = validateDefinition(yaml, {
      agentValidationCatalog: {
        ...agentValidationCatalog,
        harnesses: agentValidationCatalog.harnesses.map((harness) => {
          if (harness.id !== 'pi') return harness;
          return {
            ...harness,
            effective_tools: harness.effective_tools.filter(
              (tool) =>
                tool === 'fetch_content' || !['web_search', 'get_search_content'].includes(tool),
            ),
          };
        }),
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          path: 'jobs.inspect.steps.0.tools.1',
          message: expect.stringContaining('web_search'),
        }),
        expect.objectContaining({
          path: 'jobs.inspect.steps.0.tools.2',
          message: expect.stringContaining('get_search_content'),
        }),
      ]);
    }
  });
});
