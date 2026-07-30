import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {validateDefinition as validateDefinitionBase} from './validate-definition.js';

function validateDefinition(yaml: string, options = {}) {
  return validateDefinitionBase(yaml, {agentValidationCatalog, ...options});
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
      expect(result.warnings).toEqual([]);
      expect(result.definition.document.name).toBe('Test');
      expect(result.definition.document.jobs.build?.steps).toHaveLength(1);
      expect(result.definition.model.jobs[0]?.id).toBe('build');
    }
  });

  test('invalid YAML syntax returns { valid: false, errors }', () => {
    const result = validateDefinition('name: Bad\n  invalid:\nindentation');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result).not.toHaveProperty('warnings');
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
