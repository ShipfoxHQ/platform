import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {DefinitionParseError} from './errors.js';
import {
  parseDefinition as parseDefinitionBase,
  parseDefinitionWithDiagnostics as parseDefinitionWithDiagnosticsBase,
} from './parse-definition.js';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures');

function parseDefinition(yaml: string, options = {}) {
  return parseDefinitionBase(yaml, {agentValidationCatalog, ...options});
}

function parseDefinitionWithDiagnostics(yaml: string, options = {}) {
  return parseDefinitionWithDiagnosticsBase(yaml, {agentValidationCatalog, ...options});
}

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('parseDefinition', () => {
  test('valid simple workflow returns document and model', () => {
    const yaml = readFixture('valid-simple.yml');

    const definition = parseDefinition(yaml);

    expect(definition.document.name).toBe('Simple build');
    expect(definition.document.triggers?.on_push?.source).toBe('github_acme');
    expect(definition.document.triggers?.on_push?.event).toBe('push');
    expect(definition.document.triggers?.on_demand?.source).toBe('manual');
    expect(definition.document.triggers?.on_demand?.event).toBeUndefined();
    expect(definition.document.jobs.build?.steps).toHaveLength(2);
    expect(definition.document.jobs.build?.steps?.[0]?.run).toBe('npm install');
    const firstStep = definition.model.jobs.find((job) => job.id === 'build')?.steps[0];
    expect(firstStep).toMatchObject({kind: 'run', command: {kind: 'shell', value: 'npm install'}});
  });

  test('valid DAG workflow parses successfully', () => {
    const yaml = readFixture('valid-dag.yml');

    const definition = parseDefinition(yaml);

    expect(definition.document.name).toBe('Multi-job pipeline');
    expect(Object.keys(definition.document.jobs)).toHaveLength(4);
    expect(definition.model.dependencies).toEqual([
      {from: 'build', to: 'test-unit'},
      {from: 'build', to: 'test-integration'},
      {from: 'test-unit', to: 'deploy'},
      {from: 'test-integration', to: 'deploy'},
    ]);
  });

  test('valid listening job workflow parses successfully', () => {
    const yaml = readFixture('valid-listening-job.yml');

    const definition = parseDefinition(yaml);

    expect(definition.model.jobs[0]).toMatchObject({
      id: 'review',
      key: 'review',
      mode: 'listening',
      listening: {
        on: [{source: 'github', event: 'pull_request_review'}],
        until: [{source: 'github', event: 'pull_request'}],
        timeoutMs: 30 * 24 * 60 * 60 * 1000,
        maxExecutions: 3,
        batch: {debounceMs: 5000, maxSize: 10, maxWaitMs: 60 * 60 * 1000},
        onResolve: 'cancel',
      },
    });
    expect(definition.model.jobs[0]).toMatchObject({
      name: 'Review batch',
      executionName: [
        {kind: 'literal', value: 'Review batch '},
        {kind: 'deferred', roots: ['execution'], fillTarget: 'execution-creation'},
      ],
    });
  });

  test('attaches source line locations to workflow model steps', () => {
    const yaml = `name: Source locations
runner: ubuntu-latest
jobs:
  build:
    steps:
      - name: Install
        run: pnpm install
      # comments between authored steps are not part of either step range
      - run: |
          pnpm test
          pnpm build
        gate:
          success: step.exit_code == 0
  deploy:
    needs: build
    steps:
      - name: Deploy
        run: ./deploy.sh
`;

    const definition = parseDefinition(yaml);

    const build = definition.model.jobs.find((job) => job.id === 'build');
    const deploy = definition.model.jobs.find((job) => job.id === 'deploy');
    expect(build?.steps.map((step) => step.sourceLocation)).toEqual([
      {startLine: 6, endLine: 7},
      {startLine: 9, endLine: 13},
    ]);
    expect(deploy?.steps.map((step) => step.sourceLocation)).toEqual([
      {startLine: 17, endLine: 18},
    ]);
  });

  test('ends source line locations on the final content line of block scalar steps', () => {
    const yaml = `name: Block scalar
runner: ubuntu-latest
jobs:
  build:
    steps:
      - run: |
          echo one
          echo two
`;

    const definition = parseDefinition(yaml);

    expect(definition.model.jobs[0]?.steps[0]?.sourceLocation).toEqual({
      startLine: 6,
      endLine: 8,
    });
  });

  test('accepts default runner labels through parse options', () => {
    const yaml = `name: Default runner
jobs:
  build:
    steps:
      - run: echo hello
`;

    const definition = parseDefinition(yaml, {defaultRunnerLabels: ['ubuntu-latest']});

    expect(definition.model.jobs[0]?.runner).toEqual(['ubuntu-latest']);
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

  test('valid YAML with invalid document throws DefinitionParseError with details', () => {
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

  test('valid document with cyclic job dependencies throws DefinitionParseError', () => {
    const yaml = readFixture('invalid-cycle.yml');

    expect(() => parseDefinition(yaml)).toThrow(DefinitionParseError);
  });

  test('manual trigger without an explicit event parses and materializes fire', () => {
    const yaml = `name: Manual only
runner: ubuntu-latest
triggers:
  on_demand:
    source: manual
jobs:
  run:
    steps:
      - run: echo hello
`;

    const definition = parseDefinition(yaml);

    expect(definition.model.triggers).toEqual([
      {
        id: 'on-demand',
        key: 'on_demand',
        source: 'manual',
        event: 'fire',
      },
    ]);
  });

  test('keeps the first manual trigger active and makes later ones inert', () => {
    const yaml = `name: Multi manual
runner: ubuntu-latest
triggers:
  deploy:
    source: manual
  rollback:
    source: manual
jobs:
  run:
    steps:
      - run: echo hello
`;

    const definition = parseDefinitionWithDiagnostics(yaml);

    expect(definition.diagnostics).toEqual([
      expect.objectContaining({
        code: 'multiple-manual-triggers',
        path: 'triggers.rollback',
      }),
    ]);
    expect(definition.model.triggers.map((trigger) => trigger.key)).toEqual(['deploy']);
  });
});
