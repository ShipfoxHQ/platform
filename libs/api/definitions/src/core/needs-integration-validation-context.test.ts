import type {WorkflowDocument} from '@shipfox/workflow-document';
import {needsIntegrationValidationContext} from './needs-integration-validation-context.js';

function document(overrides: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    name: 'workflow',
    jobs: {
      build: {
        steps: [{run: 'echo hello'}],
      },
    },
    ...overrides,
  };
}

describe('needsIntegrationValidationContext', () => {
  it.each([
    ['a plain workflow', document(), false],
    ['a manual trigger', document({triggers: {run: {source: 'manual'}}}), false],
    ['a cron trigger', document({triggers: {nightly: {source: 'cron'}}}), false],
    [
      'an integration trigger',
      document({triggers: {push: {source: 'github-main', event: 'push'}}}),
      true,
    ],
    [
      'a manual listener matcher',
      document({
        jobs: {
          build: {
            listening: {on: [{source: 'manual'}], max_executions: 1},
            steps: [{run: 'echo hello'}],
          },
        },
      }),
      false,
    ],
    [
      'an integration listener matcher',
      document({
        jobs: {
          build: {
            listening: {on: [{source: 'github-main', event: 'push'}], max_executions: 1},
            steps: [{run: 'echo hello'}],
          },
        },
      }),
      true,
    ],
    [
      'an agent-step integration',
      document({
        jobs: {
          build: {
            steps: [{prompt: 'Fix the issue', integrations: [{include: ['issue_read']}]}],
          },
        },
      }),
      true,
    ],
    [
      'a tool step',
      document({
        jobs: {
          build: {
            steps: [{tool: 'list_issues', with: {}}],
          },
        },
      }),
      true,
    ],
    [
      'a tool step without a connection',
      document({
        jobs: {
          build: {
            steps: [{tool: 'issue_read.get', connection: 'github-main', with: {}}],
          },
        },
      }),
      true,
    ],
  ] as const)('%s -> %s', (_description, workflow, expected) => {
    expect(needsIntegrationValidationContext(workflow)).toBe(expected);
  });
});
