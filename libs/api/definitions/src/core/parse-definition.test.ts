import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DefinitionParseError} from './errors.js';
import {parseDefinition} from './parse-definition.js';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures');

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('parseDefinition', () => {
  test('valid simple workflow returns typed WorkflowSpec', () => {
    const yaml = readFixture('valid-simple.yml');

    const spec = parseDefinition(yaml);

    expect(spec.name).toBe('Simple build');
    expect(spec.triggers?.on_push?.type).toBe('github.push');
    expect(spec.jobs.build?.steps).toHaveLength(2);
    expect(spec.jobs.build?.steps?.[0]?.run).toBe('npm install');
  });

  test('valid DAG workflow parses successfully', () => {
    const yaml = readFixture('valid-dag.yml');

    const spec = parseDefinition(yaml);

    expect(spec.name).toBe('Multi-job pipeline');
    expect(Object.keys(spec.jobs)).toHaveLength(4);
  });

  test('invalid YAML syntax throws DefinitionParseError', () => {
    const yaml = readFixture('invalid-yaml-syntax.yml');

    expect(() => parseDefinition(yaml)).toThrow(DefinitionParseError);
  });

  test('YAML that parses to a string throws DefinitionParseError', () => {
    expect(() => parseDefinition('just a string')).toThrow(DefinitionParseError);
  });

  test('YAML that parses to null throws DefinitionParseError', () => {
    expect(() => parseDefinition('')).toThrow(DefinitionParseError);
  });

  test('YAML that parses to an array throws DefinitionParseError', () => {
    expect(() => parseDefinition('- item1\n- item2')).toThrow(DefinitionParseError);
  });

  test('valid YAML with invalid spec throws DefinitionParseError with details', () => {
    const yaml = readFixture('invalid-missing-name.yml');

    try {
      parseDefinition(yaml);
      expect.fail('Expected DefinitionParseError');
    } catch (error) {
      expect(error).toBeInstanceOf(DefinitionParseError);
      expect((error as DefinitionParseError).details).toBeDefined();
      expect(Array.isArray((error as DefinitionParseError).details)).toBe(true);
    }
  });

  test('valid spec with cyclic DAG throws DefinitionParseError', () => {
    const yaml = readFixture('invalid-cycle.yml');

    expect(() => parseDefinition(yaml)).toThrow(DefinitionParseError);
  });
});
