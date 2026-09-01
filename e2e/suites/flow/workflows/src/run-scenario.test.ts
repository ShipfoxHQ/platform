import type {CreatedIssue, listIssueComments} from '@shipfox/e2e-driver-gitea';
import {parseExpectation} from './expect.js';
import {evaluateGiteaScenario} from './run-scenario.js';

const issue: CreatedIssue = {
  number: 1,
  title: 'Fixture',
  body: 'Read me',
};

function giteaExpectation() {
  const expectation = parseExpectation({
    run: {status: 'succeeded'},
    gitea: {
      issue: {title: issue.title, body: issue.body},
      comment: 'Comment landed',
    },
  }).gitea;
  if (expectation === undefined) throw new Error('Expected a Gitea expectation');
  return expectation;
}

function scenarioParams(
  listComments?: typeof listIssueComments,
  scenarioIssue: CreatedIssue | undefined = issue,
) {
  return {
    expectation: giteaExpectation(),
    issue: scenarioIssue,
    org: 'e2e-org',
    repo: 'fixture',
    ...(listComments === undefined ? {} : {listComments}),
  };
}

describe('evaluateGiteaScenario', () => {
  test('reports a missing fixture issue', async () => {
    const listComments = vi.fn();
    const result = await evaluateGiteaScenario({...scenarioParams(listComments), issue: undefined});

    expect(result).toEqual([{path: 'gitea.issue', expected: 'created', actual: 'missing'}]);
    expect(listComments).not.toHaveBeenCalled();
  });

  test('reports an issue comment lookup failure', async () => {
    const listComments = vi.fn().mockRejectedValue(new Error('Gitea unavailable'));

    const result = await evaluateGiteaScenario(scenarioParams(listComments));

    expect(result).toEqual([
      {
        path: 'gitea.issue.comments',
        expected: 'readable',
        actual: 'Gitea unavailable',
      },
    ]);
  });

  test('reports when the expected comment is absent', async () => {
    const listComments = vi.fn().mockResolvedValue([{id: 1, body: 'Different comment'}]);

    const result = await evaluateGiteaScenario(scenarioParams(listComments));

    expect(result).toEqual([
      {
        path: 'gitea.issue.comments',
        expected: 'exact Comment landed',
        actual: 'Different comment',
      },
    ]);
  });

  test('matches the expected comment exactly', async () => {
    const listComments = vi.fn().mockResolvedValue([{id: 1, body: 'Comment landed'}]);

    const result = await evaluateGiteaScenario(scenarioParams(listComments));

    expect(result).toEqual([]);
  });
});
