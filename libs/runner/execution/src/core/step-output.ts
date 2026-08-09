export const MAX_OUTPUT_TOTAL_BYTES = 64 * 1024;
export const MAX_OUTPUT_VALUE_BYTES = 16 * 1024;

export const OUTPUT_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const OUTPUT_LINE_SPLIT_REGEX = /\r?\n/;

export class StepOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepOutputError';
  }
}

export function formatOutputSizeViolation(params: {
  key?: string;
  limitBytes: number;
  measuredBytes: number;
  scope: 'value' | 'total';
}): string {
  const prefix =
    params.scope === 'total'
      ? `Step outputs exceed the total size limit of ${params.limitBytes} bytes`
      : `Output "${params.key}" exceeds the per-value size limit of ${params.limitBytes} bytes`;
  return `${prefix} (measured ${params.measuredBytes} bytes; overshoot ${params.measuredBytes - params.limitBytes} bytes).`;
}

export function parseStepOutput(raw: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = outputLines(raw);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (isSkippableLine(line)) continue;

    const singleLine = parseSingleLineOutput(line);
    if (singleLine) {
      setOutput(outputs, singleLine.key, singleLine.value);
      continue;
    }

    const heredoc = parseHeredocStart(line);
    if (heredoc) {
      const body = collectHeredocBody(lines, index + 1, heredoc);
      setOutput(outputs, heredoc.key, body.value);
      index = body.endIndex;
      continue;
    }

    throw new StepOutputError('Output file contains a malformed line.');
  }

  return outputs;
}

interface HeredocStart {
  key: string;
  delimiter: string;
}

interface ParsedOutput {
  key: string;
  value: string;
}

interface HeredocBody {
  value: string;
  endIndex: number;
}

function outputLines(raw: string): string[] {
  return raw.split(OUTPUT_LINE_SPLIT_REGEX).map(stripTrailingCarriageReturn);
}

function isSkippableLine(line: string): boolean {
  return line.trim() === '';
}

function parseHeredocStart(line: string): HeredocStart | undefined {
  const marker = line.indexOf('<<');
  if (marker === -1) return undefined;

  const key = line.slice(0, marker);
  assertOutputKey(key);

  const delimiter = line.slice(marker + 2);
  if (delimiter === '') throw new StepOutputError(`Output "${key}" has an empty delimiter.`);

  return {key, delimiter};
}

function collectHeredocBody(
  lines: readonly string[],
  startIndex: number,
  heredoc: HeredocStart,
): HeredocBody {
  const body: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line === heredoc.delimiter) {
      return {value: body.join('\n'), endIndex: index};
    }
    body.push(line);
  }

  throw new StepOutputError(`Output "${heredoc.key}" heredoc is unterminated.`);
}

function parseSingleLineOutput(line: string): ParsedOutput | undefined {
  const equals = line.indexOf('=');
  if (equals === -1) return undefined;

  const heredocMarker = line.indexOf('<<');
  if (heredocMarker !== -1 && heredocMarker < equals) return undefined;

  const key = line.slice(0, equals);
  assertOutputKey(key);
  return {key, value: line.slice(equals + 1)};
}

function setOutput(outputs: Record<string, string>, key: string, value: string): void {
  const valueBytes = Buffer.byteLength(value, 'utf8');
  if (valueBytes > MAX_OUTPUT_VALUE_BYTES) {
    throw new StepOutputError(
      formatOutputSizeViolation({
        key,
        limitBytes: MAX_OUTPUT_VALUE_BYTES,
        measuredBytes: valueBytes,
        scope: 'value',
      }),
    );
  }
  outputs[key] = value;
}

function assertOutputKey(key: string): void {
  if (!OUTPUT_KEY_REGEX.test(key)) {
    throw new StepOutputError('Output file contains an invalid key.');
  }
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}
