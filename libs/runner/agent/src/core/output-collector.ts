import {
  coerceStepOutputs,
  type OutputDeclarations,
  type OutputTypeDeclaration,
  type StepOutputCoercionError,
} from '@shipfox/expression';
import {
  formatOutputSizeViolation,
  MAX_OUTPUT_TOTAL_BYTES,
  MAX_OUTPUT_VALUE_BYTES,
  OUTPUT_KEY_REGEX,
} from '@shipfox/runner-execution/step-output';

export type SetOutputResult = {readonly ok: true} | {readonly ok: false; readonly feedback: string};

export const MAX_OUTPUT_REPROMPTS = 2;

export class RequiredOutputsMissingError extends Error {
  constructor(public readonly missing: readonly string[]) {
    super(`Agent step finished without required outputs: ${missing.join(', ')}`);
    this.name = 'RequiredOutputsMissingError';
  }
}

export class OutputCollector {
  readonly #declarations: OutputDeclarations | undefined;
  readonly #outputs: Record<string, string> = {};

  constructor(declarations: OutputDeclarations | undefined) {
    this.#declarations = declarations;
  }

  trySet(key: string, value: string): SetOutputResult {
    const keyResult = this.#validateKey(key);
    if (!keyResult.ok) return keyResult;

    const valueBytes = Buffer.byteLength(value, 'utf8');
    if (valueBytes > MAX_OUTPUT_VALUE_BYTES) {
      return {
        ok: false,
        feedback: formatOutputSizeViolation({
          key,
          limitBytes: MAX_OUTPUT_VALUE_BYTES,
          measuredBytes: valueBytes,
          scope: 'value',
        }),
      };
    }

    const totalBytes = totalOutputBytes({...this.#outputs, [key]: value});
    if (totalBytes > MAX_OUTPUT_TOTAL_BYTES) {
      return {
        ok: false,
        feedback: formatOutputSizeViolation({
          limitBytes: MAX_OUTPUT_TOTAL_BYTES,
          measuredBytes: totalBytes,
          scope: 'total',
        }),
      };
    }

    const declaration = this.#declarations?.[key];
    if (declaration !== undefined) {
      const coerced = coerceSingleOutput(key, declaration, value);
      if (!coerced.ok) {
        return {ok: false, feedback: feedbackForCoercionError(coerced.error, declaration)};
      }
    }

    this.#outputs[key] = value;
    return {ok: true};
  }

  missingRequired(): string[] {
    if (this.#declarations === undefined) return [];
    return Object.keys(this.#declarations).filter((key) => !Object.hasOwn(this.#outputs, key));
  }

  snapshot(): Record<string, string> {
    return {...this.#outputs};
  }

  guidanceText(): string {
    return outputGuidanceText(this.#declarations);
  }

  guidanceTextFor(keys: readonly string[]): string {
    return outputGuidanceText(this.#declarations, keys);
  }

  #validateKey(key: string): SetOutputResult {
    if (!OUTPUT_KEY_REGEX.test(key)) {
      return {
        ok: false,
        feedback:
          `Output key "${key}" is invalid. Use letters, numbers, underscores, or hyphens, ` +
          `and start with a letter or underscore.${declaredKeysFeedback(this.#declarations)}`,
      };
    }

    if (this.#declarations !== undefined && !Object.hasOwn(this.#declarations, key)) {
      return {
        ok: false,
        feedback: `Output "${key}" is not declared by the step output schema.${declaredKeysFeedback(this.#declarations)}`,
      };
    }

    return {ok: true};
  }
}

export async function runOutputTurnLoop(params: {
  signal: AbortSignal;
  prompt: string;
  runTurn: (prompt: string) => Promise<void>;
  missingRequired: () => string[];
  guidanceForMissing?: (missing: readonly string[]) => string;
}): Promise<void> {
  let nextPrompt = params.prompt;
  for (let attempt = 0; attempt <= MAX_OUTPUT_REPROMPTS; attempt += 1) {
    if (params.signal.aborted) throw new Error('Agent step aborted');
    await params.runTurn(nextPrompt);
    if (params.signal.aborted) throw new Error('Agent step aborted');
    const missing = params.missingRequired();
    if (missing.length === 0) return;
    const guidance = params.guidanceForMissing?.(missing);
    if (attempt === MAX_OUTPUT_REPROMPTS) {
      throw new RequiredOutputsMissingError(missing);
    }
    nextPrompt =
      `The previous turn ended without setting required workflow outputs: ${missing.join(', ')}. ` +
      'Call set_output for each missing key, then provide your final response.' +
      (guidance === undefined ? '' : `\n\n${guidance}`);
  }
}

export function outputGuidanceText(
  declarations: OutputDeclarations | undefined,
  keys?: readonly string[],
): string {
  const base = [
    'Workflow output contract:',
    '- Before your final response, call set_output once for every required output.',
    '- The tool input has exactly two string fields: key and value.',
    '- Use each output name below as key exactly as written.',
    '- For a json output, JSON-serialize the output value into the value string. ' +
      'The decoded JSON value itself must match the schema; do not wrap it in an object named after the output key.',
  ].join('\n');
  if (declarations === undefined) {
    return `${base}\n\nThis step has no declared outputs, so any valid output key is accepted.`;
  }

  return `${base}\n\nRequired outputs:\n\n${outputSpecificationsText(declarations, keys)}`;
}

export function withOutputGuidance(prompt: string, guidance: string): string {
  return `${prompt}\n\n${guidance}`;
}

function coerceSingleOutput(
  key: string,
  declaration: OutputTypeDeclaration,
  value: string,
): ReturnType<typeof coerceStepOutputs> {
  return coerceStepOutputs({declarations: {[key]: declaration}, output: {[key]: value}});
}

function feedbackForCoercionError(
  error: StepOutputCoercionError,
  declaration: OutputTypeDeclaration,
): string {
  const validationError =
    error.schemaError === undefined ? '' : `\nSchema validation error: ${error.schemaError}`;
  return (
    `${error.message}${validationError}\n\nRetry set_output using this exact contract:\n\n` +
    outputDeclarationGuidance(error.key, declaration)
  );
}

function outputDeclarationGuidance(key: string, declaration: OutputTypeDeclaration): string {
  const lines = [
    `Output "${key}"`,
    `- key: "${key}"`,
    `- value: ${outputValueGuidance(declaration.type)}`,
  ];
  if (declaration.schema !== undefined) {
    lines.push(
      '- The decoded JSON value must match this exact JSON Schema:',
      '```json',
      JSON.stringify(declaration.schema, null, 2),
      '```',
    );
  }
  return lines.join('\n');
}

function outputSpecificationsText(
  declarations: OutputDeclarations | undefined,
  keys?: readonly string[],
): string {
  if (declarations === undefined) return '';
  const requestedKeys = keys === undefined ? Object.keys(declarations) : keys;
  return requestedKeys
    .flatMap((key) => {
      const declaration = declarations[key];
      return declaration === undefined ? [] : [outputDeclarationGuidance(key, declaration)];
    })
    .join('\n\n');
}

function declaredKeysFeedback(declarations: OutputDeclarations | undefined): string {
  if (declarations === undefined) return '';
  const keys = Object.keys(declarations);
  return keys.length === 0
    ? ' This step declares no output keys.'
    : ` Use one of these exact keys: ${keys.join(', ')}.`;
}

function outputValueGuidance(type: OutputTypeDeclaration['type']): string {
  switch (type) {
    case 'string':
      return 'the text value';
    case 'number':
      return 'number encoded as a string';
    case 'boolean':
      return 'exactly "true" or "false"';
    case 'json':
      return 'JSON text encoded as a string';
  }
}

function totalOutputBytes(outputs: Record<string, string>): number {
  return Object.entries(outputs).reduce(
    (total, [key, value]) => total + Buffer.byteLength(`${key}=${value}\n`, 'utf8'),
    0,
  );
}
