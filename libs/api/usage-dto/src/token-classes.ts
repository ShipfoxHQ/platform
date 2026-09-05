import {type InferenceSegmentInputDto, isOpenAiInferenceDialect} from './schemas/usage.js';

/** The four token classes used for display and pricing, plus derived totals. */
export interface NormalisedTokenClasses {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitRate: number;
}

type TokenClassSegment = Pick<
  InferenceSegmentInputDto,
  | 'dialect'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheCreationTokens'
  | 'cacheReadTokens'
  | 'reasoningTokens'
>;

/**
 * Maps dialect-specific reported counts to the four priced token classes.
 *
 * Reasoning tokens are retained in the raw segment for detail views, but are
 * not added here because they are already included in the reported output
 * count used for display and pricing.
 */
export function normaliseTokenClasses(segment: TokenClassSegment): NormalisedTokenClasses {
  const isOpenAiDialect = isOpenAiInferenceDialect(segment.dialect);
  const cachedInputTokens = segment.cacheReadTokens;
  const inputTokens = isOpenAiDialect
    ? Math.max(0, segment.inputTokens - cachedInputTokens)
    : segment.inputTokens;
  const cacheWriteTokens = isOpenAiDialect ? 0 : segment.cacheCreationTokens;
  const outputTokens = segment.outputTokens;
  const totalInputTokens = inputTokens + cachedInputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens: inputTokens + cachedInputTokens + cacheWriteTokens + outputTokens,
    cacheHitRate: totalInputTokens === 0 ? 0 : cachedInputTokens / totalInputTokens,
  };
}
