import {
  commitSessionTranscriptQuerySchema,
  commitSessionTranscriptResponseSchema,
  sessionTranscriptQuerySchema,
} from './session-transcript.js';

describe('sessionTranscriptQuerySchema', () => {
  it('coerces string query params to integers', () => {
    const parsed = sessionTranscriptQuerySchema.parse({attempt: '1'});

    expect(parsed).toEqual({attempt: 1});
  });

  it('rejects an attempt below 1', () => {
    const parse = () => sessionTranscriptQuerySchema.parse({attempt: '0'});

    expect(parse).toThrow();
  });
});

describe('commitSessionTranscriptQuerySchema', () => {
  it('accepts base segment 0 for the first commit of a fresh session', () => {
    const parsed = commitSessionTranscriptQuerySchema.parse({attempt: '1', base_segment: '0'});

    expect(parsed).toEqual({attempt: 1, base_segment: 0});
  });

  it('rejects a negative base segment', () => {
    const parse = () =>
      commitSessionTranscriptQuerySchema.parse({attempt: '1', base_segment: '-1'});

    expect(parse).toThrow();
  });
});

describe('commitSessionTranscriptResponseSchema', () => {
  it('accepts a committed outcome', () => {
    const parsed = commitSessionTranscriptResponseSchema.parse({
      status: 'committed',
      segment: 4,
    });

    expect(parsed).toEqual({status: 'committed', segment: 4});
  });

  it('accepts a retry-acked outcome', () => {
    const parsed = commitSessionTranscriptResponseSchema.parse({
      status: 'retry-acked',
      segment: 4,
    });

    expect(parsed).toEqual({status: 'retry-acked', segment: 4});
  });

  it('rejects an unknown outcome', () => {
    const parse = () =>
      commitSessionTranscriptResponseSchema.parse({status: 'conflict', segment: 4});

    expect(parse).toThrow();
  });
});
