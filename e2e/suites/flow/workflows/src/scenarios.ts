import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {z} from 'zod';
import {type Expectation, parseExpectation} from './expect.js';
import {parseRejection, type Rejection} from './reject.js';

const seededSecretSchema = z
  .object({
    key: z.string().min(1),
    value: z.string(),
    scope: z.enum(['workspace', 'project']).default('project'),
  })
  .strict();

const seededSecretsSchema = z
  .object({
    secrets: z.array(seededSecretSchema).default([]),
  })
  .strict();

const seededVariableSchema = z
  .object({
    key: z.string().min(1),
    value: z.string(),
    scope: z.enum(['workspace', 'project']).default('project'),
  })
  .strict();

const seededVariablesSchema = z
  .object({
    variables: z.array(seededVariableSchema).default([]),
  })
  .strict();

const modelProviderSchema = z
  .object({
    script_key: z.string().min(1),
  })
  .strict();

export type SeededSecret = z.infer<typeof seededSecretSchema>;
export type SeededVariable = z.infer<typeof seededVariableSchema>;

export interface ScenarioFile {
  path: string;
  content: string;
}

interface BaseScenario {
  name: string;
  dir: string;
  configPath: string;
  workflowYaml: string;
  extraFiles: ScenarioFile[];
  seededSecrets: SeededSecret[];
  seededVariables: SeededVariable[];
  fakeModelProviderScriptKey?: string | undefined;
}

export interface ExpectScenario extends BaseScenario {
  kind: 'expect';
  expectation: Expectation;
}

export interface RejectScenario extends BaseScenario {
  kind: 'reject';
  rejection: Rejection;
}

export type Scenario = ExpectScenario | RejectScenario;

const scenariosRoot = fileURLToPath(new URL('../scenarios/', import.meta.url));

function readScenarioFiles(filesDir: string): ScenarioFile[] {
  if (!existsSync(filesDir)) return [];
  const files: ScenarioFile[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const absolute = join(current, entry);
      if (statSync(absolute).isDirectory()) {
        walk(absolute);
      } else {
        files.push({
          path: relative(filesDir, absolute).split('\\').join('/'),
          content: readFileSync(absolute, 'utf8'),
        });
      }
    }
  };
  walk(filesDir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function requireScenarioFile(dir: string, scenario: string, file: string): string {
  const path = join(dir, file);
  if (!existsSync(path)) throw new Error(`Scenario "${scenario}" is missing ${file}`);
  return path;
}

function loadSeededSecrets(dir: string): SeededSecret[] {
  const path = join(dir, 'secrets.yaml');
  if (!existsSync(path)) return [];
  return seededSecretsSchema.parse(yaml.load(readFileSync(path, 'utf8'))).secrets;
}

function loadSeededVariables(dir: string): SeededVariable[] {
  const path = join(dir, 'variables.yaml');
  if (!existsSync(path)) return [];
  return seededVariablesSchema.parse(yaml.load(readFileSync(path, 'utf8'))).variables;
}

function loadModelProviderScriptKey(dir: string): string | undefined {
  const path = join(dir, 'model-provider.yaml');
  if (!existsSync(path)) return undefined;
  return modelProviderSchema.parse(yaml.load(readFileSync(path, 'utf8'))).script_key;
}

function loadScenario(root: string, name: string): Scenario {
  const dir = join(root, name);
  const workflowPath = requireScenarioFile(dir, name, 'workflow.yml');
  const expectPath = join(dir, 'expect.yaml');
  const rejectPath = join(dir, 'reject.yaml');
  const hasExpect = existsSync(expectPath);
  const hasReject = existsSync(rejectPath);

  if (hasExpect === hasReject) {
    throw new Error(`Scenario "${name}" must contain exactly one of expect.yaml or reject.yaml`);
  }

  const base = {
    name,
    dir,
    configPath: `.shipfox/workflows/${name}.yml`,
    workflowYaml: readFileSync(workflowPath, 'utf8'),
    extraFiles: readScenarioFiles(join(dir, 'files')),
    seededSecrets: loadSeededSecrets(dir),
    seededVariables: loadSeededVariables(dir),
    fakeModelProviderScriptKey: loadModelProviderScriptKey(dir),
  };

  if (hasExpect) {
    return {
      ...base,
      kind: 'expect',
      expectation: parseExpectation(yaml.load(readFileSync(expectPath, 'utf8'))),
    };
  }

  return {
    ...base,
    kind: 'reject',
    rejection: parseRejection(yaml.load(readFileSync(rejectPath, 'utf8'))),
  };
}

/**
 * Every directory under scenarios/ that carries an expect.yaml or reject.yaml is
 * a declarative scenario the generic spec drives. Directories with a spec.e2e.ts
 * instead are ordinary Playwright specs (the escape hatch) and are skipped here.
 */
export function discoverScenarios(root = scenariosRoot): Scenario[] {
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .filter(
      (name) =>
        existsSync(join(root, name, 'expect.yaml')) || existsSync(join(root, name, 'reject.yaml')),
    )
    .sort()
    .map((name) => loadScenario(root, name));
}
