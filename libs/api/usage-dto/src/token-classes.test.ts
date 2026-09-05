import {normaliseTokenClasses} from './index.js';

const baseSegment = {
  inputTokens: 100,
  outputTokens: 30,
  cacheCreationTokens: 5,
  cacheReadTokens: 20,
  reasoningTokens: 9,
};

describe('normaliseTokenClasses', () => {
  it('keeps Anthropic reported input and cache-write classes separate', () => {
    expect(normaliseTokenClasses({...baseSegment, dialect: 'anthropic-messages'})).toEqual({
      inputTokens: 100,
      cachedInputTokens: 20,
      cacheWriteTokens: 5,
      outputTokens: 30,
      totalTokens: 155,
      cacheHitRate: 20 / 120,
    });
  });

  it.each([
    'openai-completions',
    'openai-responses',
  ] as const)('subtracts cached input from the OpenAI %s input subset', (dialect) => {
    expect(normaliseTokenClasses({...baseSegment, dialect})).toEqual({
      inputTokens: 80,
      cachedInputTokens: 20,
      cacheWriteTokens: 0,
      outputTokens: 30,
      totalTokens: 130,
      cacheHitRate: 0.2,
    });
  });

  it.each([
    'anthropic-messages',
    'openai-completions',
    'openai-responses',
  ] as const)('returns zero cache classes and a zero hit rate for an empty %s segment', (dialect) => {
    expect(
      normaliseTokenClasses({
        dialect,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
      }),
    ).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheHitRate: 0,
    });
  });
});
