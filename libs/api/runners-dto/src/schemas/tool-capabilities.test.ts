import {runnerToolCapabilitiesSchema} from './tool-capabilities.js';

describe('runnerToolCapabilitiesSchema', () => {
  it('accepts a capability report with protocol features separate from harness tools', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({
      features: {renewable_git: true},
      harnesses: {
        pi: {tools: ['read', 'bash', 'web_search']},
        claude: {tools: ['Read', 'Bash', 'WebSearch']},
      },
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.features?.renewable_git).toBe(true);
  });

  it('accepts a partial capability report without features for old runners', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({
      harnesses: {
        pi: {tools: ['read']},
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts the renewable inference feature flag', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({
      features: {renewable_git: true, renewable_inference: true},
      harnesses: {},
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.features?.renewable_inference).toBe(true);
  });

  it('requires renewable_git when protocol features are present', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({
      features: {},
      harnesses: {},
    });

    expect(result.success).toBe(false);
  });

  it('accepts no harness support', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({harnesses: {}});

    expect(result.success).toBe(true);
  });

  it('rejects unknown protocol features', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({
      features: {renewable_git: false, unknown_feature: true},
      harnesses: {},
    });

    expect(result.success).toBe(false);
  });

  it('accepts an empty tool array', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({
      harnesses: {
        claude: {tools: []},
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects duplicate tool names per harness', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({
      harnesses: {
        pi: {tools: ['read', 'read']},
      },
    });

    expect(result.success).toBe(false);
  });

  it.each([
    null,
    {},
    {harnesses: {}, extra: true},
    {harnesses: {pi: {tools: ['read']}, unknown: {tools: ['x']}}},
    {harnesses: {pi: {tools: ['read'], extra: true}}},
    {harnesses: {pi: {tools: ['']}}},
    {harnesses: {pi: {tools: [42]}}},
  ])('rejects malformed capability report %#', (value) => {
    const result = runnerToolCapabilitiesSchema.safeParse(value);

    expect(result.success).toBe(false);
  });
});
