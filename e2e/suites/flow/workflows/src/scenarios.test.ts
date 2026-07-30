import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverScenarios} from './scenarios.js';

function createTempScenariosRoot(): string {
  return mkdtempSync(join(tmpdir(), 'shipfox-e2e-scenarios-'));
}

function writeScenarioFile(root: string, scenario: string, file: string, content: string): void {
  const dir = join(root, scenario);
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, file), content);
}

describe('discoverScenarios', () => {
  test('loads directories that contain expect.yaml and workflow.yml', () => {
    const root = createTempScenariosRoot();
    try {
      writeScenarioFile(root, 'hello', 'expect.yaml', 'run:\n  status: succeeded\n');
      writeScenarioFile(root, 'hello', 'workflow.yml', 'jobs:\n  build:\n    steps: []\n');

      const scenarios = discoverScenarios(root);

      expect(scenarios).toHaveLength(1);
      expect(scenarios[0]).toMatchObject({
        kind: 'expect',
        name: 'hello',
        configPath: '.shipfox/workflows/hello.yml',
        workflowYaml: 'jobs:\n  build:\n    steps: []\n',
      });
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('loads optional scenario secrets', () => {
    const root = createTempScenariosRoot();
    try {
      writeScenarioFile(root, 'with-secrets', 'expect.yaml', 'run:\n  status: succeeded\n');
      writeScenarioFile(root, 'with-secrets', 'workflow.yml', 'jobs:\n  build:\n    steps: []\n');
      writeScenarioFile(
        root,
        'with-secrets',
        'secrets.yaml',
        'secrets:\n  - key: API_TOKEN\n    value: runtime-secret\n',
      );

      const scenarios = discoverScenarios(root);

      expect(scenarios[0]).toMatchObject({
        seededSecrets: [{key: 'API_TOKEN', value: 'runtime-secret', scope: 'project'}],
      });
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('loads optional scenario variables', () => {
    const root = createTempScenariosRoot();
    try {
      writeScenarioFile(root, 'with-variables', 'expect.yaml', 'run:\n  status: succeeded\n');
      writeScenarioFile(root, 'with-variables', 'workflow.yml', 'jobs:\n  build:\n    steps: []\n');
      writeScenarioFile(
        root,
        'with-variables',
        'variables.yaml',
        'variables:\n  - key: PUBLISHING_ENABLED\n    value: "true"\n',
      );

      const scenarios = discoverScenarios(root);

      expect(scenarios[0]).toMatchObject({
        seededVariables: [{key: 'PUBLISHING_ENABLED', value: 'true', scope: 'project'}],
      });
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('loads optional fake model provider script metadata', () => {
    const root = createTempScenariosRoot();
    try {
      writeScenarioFile(root, 'with-model-provider', 'expect.yaml', 'run:\n  status: succeeded\n');
      writeScenarioFile(
        root,
        'with-model-provider',
        'workflow.yml',
        'jobs:\n  build:\n    steps: []\n',
      );
      writeScenarioFile(
        root,
        'with-model-provider',
        'model-provider.yaml',
        'script_key: agent-output-tool\n',
      );

      const scenarios = discoverScenarios(root);

      expect(scenarios[0]).toMatchObject({
        fakeModelProviderScriptKey: 'agent-output-tool',
      });
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('loads directories that contain reject.yaml and workflow.yml', () => {
    const root = createTempScenariosRoot();
    try {
      writeScenarioFile(
        root,
        'rejected',
        'reject.yaml',
        'message_includes:\n  - unknown-interpolation-context\n',
      );
      writeScenarioFile(root, 'rejected', 'workflow.yml', 'jobs:\n  build:\n    steps: []\n');

      const scenarios = discoverScenarios(root);

      expect(scenarios).toHaveLength(1);
      expect(scenarios[0]).toMatchObject({
        kind: 'reject',
        name: 'rejected',
        rejection: {
          error_code: 'invalid-definition',
          message_includes: ['unknown-interpolation-context'],
        },
      });
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('rejects directories that contain both declarative manifests', () => {
    const root = createTempScenariosRoot();
    try {
      writeScenarioFile(root, 'ambiguous', 'expect.yaml', 'run:\n  status: succeeded\n');
      writeScenarioFile(root, 'ambiguous', 'reject.yaml', 'message_includes: []\n');
      writeScenarioFile(root, 'ambiguous', 'workflow.yml', 'jobs:\n  build:\n    steps: []\n');

      const act = () => discoverScenarios(root);

      expect(act).toThrow(
        'Scenario "ambiguous" must contain exactly one of expect.yaml or reject.yaml',
      );
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('reports the scenario name when workflow.yml is missing', () => {
    const root = createTempScenariosRoot();
    try {
      writeScenarioFile(root, 'missing-workflow', 'expect.yaml', 'run:\n  status: succeeded\n');

      const act = () => discoverScenarios(root);

      expect(act).toThrow('Scenario "missing-workflow" is missing workflow.yml');
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
