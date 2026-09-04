import type {WorkflowRunOverview, WorkflowRunOverviewJob} from '#core/workflow-run.js';
import {workflowRunOverview, workflowRunOverviewJob} from '#test/fixtures/workflow-run.js';
import {buildJobGraphModel, nextJobGraphNodeId} from './graph-model.js';

describe('buildJobGraphModel', () => {
  test('returns an empty model', () => {
    const run = makeRun({jobs: []});

    const result = buildJobGraphModel({run});

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.columns).toEqual([]);
  });

  test('maps a single job with a trigger edge', () => {
    const run = makeRun({jobs: [makeJob({name: 'build'})]});

    const result = buildJobGraphModel({run});

    expect(result.nodes).toMatchObject([{name: 'build', column: 0, row: 0}]);
    expect(result.edges).toMatchObject([
      {from: 'trigger', to: result.nodes[0]?.id, kind: 'trigger'},
    ]);
  });

  test('resolves dependencies by job key', () => {
    const build = makeJob({name: 'build', position: 0});
    const deploy = makeJob({name: 'deploy', position: 1, dependencies: ['build']});
    const run = makeRun({jobs: [deploy, build]});

    const result = buildJobGraphModel({run});

    expect(nodeByName(result, 'build')).toMatchObject({column: 0});
    expect(nodeByName(result, 'deploy')).toMatchObject({column: 1, dependencies: ['build']});
    expect(result.edges).toContainEqual(
      expect.objectContaining({from: build.id, to: deploy.id, kind: 'dependency'}),
    );
  });

  test('emits one trigger edge for each root job in parallel fan-out', () => {
    const jobs = Array.from({length: 10}, (_, index) =>
      makeJob({name: `job-${String(index + 1).padStart(2, '0')}`, position: index}),
    );
    const run = makeRun({jobs});

    const result = buildJobGraphModel({run});

    expect(result.columns).toHaveLength(1);
    expect(result.columns[0]).toHaveLength(10);
    expect(result.edges.filter((edge) => edge.kind === 'trigger')).toHaveLength(10);
  });

  test('orders parallel jobs by position inside a column', () => {
    const run = makeRun({
      jobs: [
        makeJob({name: 'zeta', position: 2}),
        makeJob({name: 'alpha', position: 1}),
        makeJob({name: 'middle', position: 3}),
      ],
    });

    const result = buildJobGraphModel({run});

    expect(result.columns[0]?.map((node) => node.name)).toEqual(['alpha', 'zeta', 'middle']);
  });

  test('lays out a ten-job sequence across ten columns', () => {
    const jobs = Array.from({length: 10}, (_, index) =>
      makeJob({
        name: `job-${String(index + 1).padStart(2, '0')}`,
        position: index,
        dependencies: index === 0 ? [] : [`job-${String(index).padStart(2, '0')}`],
      }),
    );
    const run = makeRun({jobs});

    const result = buildJobGraphModel({run});

    expect(result.columns).toHaveLength(10);
    expect(nodeByName(result, 'job-10')).toMatchObject({column: 9});
  });

  test('places branch siblings in the same column and a join after them', () => {
    const build = makeJob({name: 'build', position: 0});
    const lint = makeJob({name: 'lint', position: 1, dependencies: ['build']});
    const testJob = makeJob({name: 'test', position: 2, dependencies: ['build']});
    const deploy = makeJob({name: 'deploy', position: 3, dependencies: ['lint', 'test']});
    const run = makeRun({jobs: [deploy, testJob, lint, build]});

    const result = buildJobGraphModel({run});

    expect(nodeByName(result, 'lint')).toMatchObject({column: 1});
    expect(nodeByName(result, 'test')).toMatchObject({column: 1});
    expect(nodeByName(result, 'deploy')).toMatchObject({column: 2});
    expect(nodeByName(result, 'deploy')?.dependencies).toEqual(['lint', 'test']);
  });

  test('moves keyboard navigation across columns and rows', () => {
    const build = makeJob({name: 'build', position: 0});
    const lint = makeJob({name: 'lint', position: 1, dependencies: ['build']});
    const testJob = makeJob({name: 'test', position: 2, dependencies: ['build']});
    const deploy = makeJob({name: 'deploy', position: 3, dependencies: ['lint', 'test']});
    const run = makeRun({jobs: [build, lint, testJob, deploy]});
    const model = buildJobGraphModel({run});

    const nextFromBuild = nextJobGraphNodeId({
      model,
      currentNodeId: build.id,
      key: 'ArrowRight',
    });
    const downFromLint = nextJobGraphNodeId({
      model,
      currentNodeId: lint.id,
      key: 'ArrowDown',
    });
    const rightFromTest = nextJobGraphNodeId({
      model,
      currentNodeId: testJob.id,
      key: 'ArrowRight',
    });

    expect(nextFromBuild).toBe(lint.id);
    expect(downFromLint).toBe(testJob.id);
    expect(rightFromTest).toBe(deploy.id);
  });

  test('keeps downstream skipped status as the persisted status', () => {
    const build = makeJob({name: 'build', status: 'failed'});
    const deploy = makeJob({
      name: 'deploy',
      status: 'skipped',
      status_reason: 'dependency_not_completed',
      position: 1,
      dependencies: ['build'],
    });
    const run = makeRun({jobs: [build, deploy]});

    const result = buildJobGraphModel({run});

    expect(nodeByName(result, 'deploy')).toMatchObject({
      status: 'skipped',
    });
  });

  test('counts only pending and running known dependencies as current', () => {
    const pending = makeJob({name: 'build', status: 'pending'});
    const running = makeJob({name: 'test', status: 'running', position: 1});
    const succeeded = makeJob({name: 'lint', status: 'succeeded', position: 2});
    const failed = makeJob({name: 'security', status: 'failed', position: 3});
    const cancelled = makeJob({name: 'docs', status: 'cancelled', position: 4});
    const skipped = makeJob({name: 'deploy-preview', status: 'skipped', position: 5});
    const deploy = makeJob({
      name: 'deploy',
      position: 6,
      dependencies: ['build', 'test', 'lint', 'security', 'docs', 'deploy-preview', 'missing'],
    });
    const run = makeRun({jobs: [deploy, skipped, cancelled, failed, succeeded, running, pending]});

    const result = buildJobGraphModel({run});

    expect(nodeByName(result, 'deploy')).toMatchObject({
      currentDependencyCount: 2,
    });
  });
});

function nodeByName(result: ReturnType<typeof buildJobGraphModel>, name: string) {
  return result.nodes.find((node) => node.name === name);
}

function makeRun({jobs = [], ...overrides}: RunOverrides = {}): WorkflowRunOverview {
  return {
    ...workflowRunOverview({
      name: 'Deploy',
      trigger_provider: 'github',
      trigger_source: 'github_acme',
      trigger_event: 'push',
      started_at: '2026-06-21T12:00:10.000Z',
      jobs: [],
    }),
    ...overrides,
    jobs: {kind: 'complete', total: jobs.length, items: jobs},
  };
}

type RunOverrides = Omit<Partial<WorkflowRunOverview>, 'jobs'> & {
  jobs?: WorkflowRunOverviewJob[];
};

function makeJob(
  overrides: Parameters<typeof workflowRunOverviewJob>[0] & {name: string},
): WorkflowRunOverviewJob {
  return workflowRunOverviewJob({key: overrides.key ?? overrides.name, ...overrides});
}
