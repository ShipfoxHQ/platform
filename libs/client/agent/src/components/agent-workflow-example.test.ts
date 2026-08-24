import {workflowDocumentSchema} from '@shipfox/workflow-document';
import {parse} from 'yaml';
import {buildAgentWorkflowExample} from './agent-workflow-example.js';

describe('buildAgentWorkflowExample', () => {
  it.each([
    {
      harness: 'pi',
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      expectedHarness: '        harness: pi',
      expectedProvider: '        provider: anthropic',
      expectedModel: '        model: claude-opus-4-8',
    },
    {
      harness: 'claude',
      providerId: 'anthropic',
      model: 'anthropic/claude-opus-4.8',
      expectedHarness: '        harness: claude',
      expectedProvider: '        provider: anthropic',
      expectedModel: '        model: anthropic/claude-opus-4.8',
    },
    {
      harness: 'pi',
      providerId: 'anthropic',
      model: '@cf/moonshotai/kimi-k2.7-code',
      expectedHarness: '        harness: pi',
      expectedProvider: '        provider: anthropic',
      expectedModel: "        model: '@cf/moonshotai/kimi-k2.7-code'",
    },
    {
      harness: 'pi',
      providerId: 'provider#beta',
      model: "model: beta's",
      expectedHarness: '        harness: pi',
      expectedProvider: "        provider: 'provider#beta'",
      expectedModel: "        model: 'model: beta''s'",
    },
    {
      harness: 'pi',
      providerId: 'true',
      model: '123',
      expectedHarness: '        harness: pi',
      expectedProvider: "        provider: 'true'",
      expectedModel: "        model: '123'",
    },
  ])('builds valid workflow YAML for provider $providerId and model $model', ({
    harness,
    providerId,
    model,
    expectedHarness,
    expectedProvider,
    expectedModel,
  }) => {
    const example = buildAgentWorkflowExample({harness, providerId, model});

    const lines = example.code.split('\n');
    const parsed = parse(example.code);
    const parsedStep = parsed as {
      jobs: {agent: {steps: Array<{harness?: unknown; provider?: unknown; model?: unknown}>}};
    };
    const result = workflowDocumentSchema.safeParse(parsed);

    expect(result.success).toBe(true);
    expect(parsedStep.jobs.agent.steps[0]?.harness).toBe(harness);
    expect(parsedStep.jobs.agent.steps[0]?.provider).toBe(providerId);
    expect(parsedStep.jobs.agent.steps[0]?.model).toBe(model);
    expect(lines).toContain(expectedHarness);
    expect(lines).toContain(expectedProvider);
    expect(lines).toContain(expectedModel);
    expect(example.highlightedLineRange).toEqual({startLine: 10, endLine: 12});
    expect(lines.slice(9, 12)).toEqual([expectedHarness, expectedProvider, expectedModel]);
  });
});
