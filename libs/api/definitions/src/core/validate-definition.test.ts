import {validateDefinition} from './validate-definition.js';

describe('validateDefinition', () => {
  test('valid YAML returns { valid: true, spec }', () => {
    const yaml = `
name: Test
jobs:
  build:
    steps:
      - run: echo hello
`;

    const result = validateDefinition(yaml);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.spec.name).toBe('Test');
      expect(result.spec.jobs.build?.steps).toHaveLength(1);
    }
  });

  test('invalid YAML syntax returns { valid: false, errors }', () => {
    const result = validateDefinition('name: Bad\n  invalid:\nindentation');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain('Invalid YAML syntax');
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

  test('invalid spec returns { valid: false, errors with details }', () => {
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
});
