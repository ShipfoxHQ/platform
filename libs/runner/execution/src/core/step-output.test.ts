import {MAX_OUTPUT_VALUE_BYTES, parseStepOutput, StepOutputError} from '#core/step-output.js';

describe('parseStepOutput', () => {
  it('parses single-line outputs', () => {
    const result = parseStepOutput('sha=abc123\n');

    expect(result).toEqual({sha: 'abc123'});
  });

  it('parses empty values', () => {
    const result = parseStepOutput('sha=\n');

    expect(result).toEqual({sha: ''});
  });

  it('parses multiline heredoc outputs', () => {
    const result = parseStepOutput('notes<<EOF\nline one\nline two\nEOF\n');

    expect(result).toEqual({notes: 'line one\nline two'});
  });

  it('throws on unterminated heredocs', () => {
    const parse = () => parseStepOutput('notes<<EOF\nline one\n');

    expect(parse).toThrow(StepOutputError);
  });

  it('skips blank lines between entries and preserves them inside heredocs', () => {
    const result = parseStepOutput('\nfirst=one\n\nnotes<<EOF\nline one\n\nline three\nEOF\n');

    expect(result).toEqual({first: 'one', notes: 'line one\n\nline three'});
  });

  it('skips whitespace-only lines between entries and preserves them inside heredocs', () => {
    const result = parseStepOutput('first=one\n  \t  \nnotes<<EOF\n  \t  \nEOF\n');

    expect(result).toEqual({first: 'one', notes: '  \t  '});
  });

  it('parses CRLF input', () => {
    const result = parseStepOutput('sha=abc123\r\nnotes<<EOF\r\nline one\r\nEOF\r\n');

    expect(result).toEqual({sha: 'abc123', notes: 'line one'});
  });

  it.each(['=value', '1key=value', 'bad key=value'])('throws on invalid key %j', (raw) => {
    const parse = () => parseStepOutput(raw);

    expect(parse).toThrow(StepOutputError);
  });

  it('accepts hyphenated keys', () => {
    const result = parseStepOutput('build-sha=abc123\n');

    expect(result).toEqual({'build-sha': 'abc123'});
  });

  it('throws when a value exceeds the per-value byte cap', () => {
    const measuredBytes = MAX_OUTPUT_VALUE_BYTES + 1;
    const value = 'x'.repeat(measuredBytes);
    const parse = () => parseStepOutput(`payload=${value}`);

    expect(parse).toThrow(StepOutputError);
    expect(parse).toThrow(
      `Output "payload" exceeds the per-value size limit of ${MAX_OUTPUT_VALUE_BYTES} bytes ` +
        `(measured ${measuredBytes} bytes; overshoot ${measuredBytes - MAX_OUTPUT_VALUE_BYTES} bytes).`,
    );
  });

  it('lets duplicate keys use the last value', () => {
    const result = parseStepOutput('sha=old\nsha=new\n');

    expect(result).toEqual({sha: 'new'});
  });

  it('does not close heredocs on delimiter substrings', () => {
    const result = parseStepOutput('notes<<EOF\nnot EOF yet\nEOF\n');

    expect(result).toEqual({notes: 'not EOF yet'});
  });

  it('treats heredoc delimiter whitespace literally', () => {
    const parse = () => parseStepOutput('notes<< EOF\nline one\nEOF\n');

    expect(parse).toThrow(StepOutputError);
  });

  it('parses heredoc markers inside single-line values literally', () => {
    const result = parseStepOutput('payload=value-with-<<-marker\n');

    expect(result).toEqual({payload: 'value-with-<<-marker'});
  });

  it('returns an empty object for empty input', () => {
    const result = parseStepOutput('');

    expect(result).toEqual({});
  });
});
