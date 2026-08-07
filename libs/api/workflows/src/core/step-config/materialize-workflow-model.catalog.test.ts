import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {workflowModel} from '#test/index.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'api-workflows-runner-catalog-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(dir, {recursive: true, force: true});
});

function template(source: string): string {
  return `\${{ ${source} }}`;
}

function writeCatalog(contents: string): string {
  const path = join(dir, 'runner-catalog.yaml');
  writeFileSync(path, contents);
  return path;
}

function executionContext(runner: string) {
  return {
    site: 'execution-creation' as const,
    values: {
      run: {
        id: 'run-1',
        name: 'Build',
        definition_id: 'definition-1',
        project_id: 'project-1',
        workspace_id: 'workspace-1',
        created_at: new Date('2026-06-30T12:00:00.000Z'),
      },
      trigger: {source: 'manual', event: 'fire'},
      event: null,
      inputs: null,
      execution: {
        index: 1,
        name: 'build #1',
        status: 'pending',
        started_at: null,
        finished_at: null,
        events: [{data: {runner}, source: 'github', event: 'push'}],
      },
    },
  };
}

describe('materializeJobRunner with a catalog', () => {
  it('expands an interpolated catalog name and keeps free-form labels', async () => {
    const path = writeCatalog(`
shipfox-4cpu:
  - arch.amd64
  - cpu.4
`);
    vi.stubEnv('RUNNER_CATALOG_PATH', path);
    vi.resetModules();

    const {materializeJobRunner} = await import('./materialize-workflow-model.js');
    const model = workflowModel({
      jobs: {
        build: {
          runner: ['internal-network'],
          runnerTemplates: [template('execution.events[0].data.runner')],
          steps: [{run: 'npm test'}],
        },
      },
    });
    const [job] = model.jobs;
    if (!job) throw new Error('Test model created no jobs');

    const result = materializeJobRunner({
      job,
      context: executionContext('SHIPFOX-4CPU'),
      definitionId: 'definition-1',
    });

    expect(result).toEqual(['arch.amd64', 'cpu.4', 'internal-network']);
  });

  it('validates the combined expanded label count', async () => {
    const labels = (suffix: string) =>
      Array.from({length: 8}, (_, index) => `  - label-${index}${suffix}`).join('\n');
    const path = writeCatalog(
      `first:\n${labels('')}\nsecond:\n${labels('-second')}\nthird:\n${labels('-third')}\n`,
    );
    vi.stubEnv('RUNNER_CATALOG_PATH', path);
    vi.resetModules();

    const {materializeJobRunner} = await import('./materialize-workflow-model.js');
    const model = workflowModel({
      jobs: {
        build: {
          runner: [],
          runnerTemplates: [template('"first"'), template('"second"'), template('"third"')],
          steps: [{run: 'npm test'}],
        },
      },
    });
    const [job] = model.jobs;
    if (!job) throw new Error('Test model created no jobs');

    expect(() =>
      materializeJobRunner({
        job,
        context: executionContext('unused'),
        definitionId: 'definition-1',
      }),
    ).toThrow('requested: first, second, third');
  });
});
