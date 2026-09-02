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

export type OutputRejectionCode =
  | 'invalid_output_key'
  | 'undeclared_output'
  | 'output_value_too_large'
  | 'output_total_too_large'
  | 'output_schema_mismatch'
  | 'output_conflict';

export interface OutputRejectionDetails {
  readonly code: OutputRejectionCode;
  readonly key: string;
  readonly limitBytes?: number;
  readonly measuredBytes?: number;
  readonly schemaError?: string;
}

export type SetOutputResult =
  | {readonly ok: true}
  | {readonly ok: true; readonly idempotent: true}
  | {
      readonly ok: false;
      readonly isError: true;
      readonly code: OutputRejectionCode;
      readonly feedback: string;
      readonly details: OutputRejectionDetails;
    };

export const MAX_OUTPUT_REPROMPTS = 2;

export class RequiredOutputsMissingError extends Error {
  constructor(public readonly missing: readonly string[]) {
    super(`Agent step finished without required outputs: ${missing.join(', ')}`);
    this.name = 'RequiredOutputsMissingError';
  }
}

export class OutputCollector {
  readonly #declarations: OutputDeclarations | undefined;
  readonly #outputs: Record<string, string> = Object.create(null);

  constructor(declarations: OutputDeclarations | undefined) {
    this.#declarations = declarations;
  }

  trySet(key: string, value: string): SetOutputResult {
    const keyResult = this.#validateKey(key);
    if (!keyResult.ok) return keyResult;

    if (Object.hasOwn(this.#outputs, key)) {
      return this.#outputs[key] === value
        ? {ok: true, idempotent: true}
        : rejection(
            'output_conflict',
            `Output "${key}" is immutable and already has a different value.`,
            {key},
          );
    }

    const valueBytes = Buffer.byteLength(value, 'utf8');
    if (valueBytes > MAX_OUTPUT_VALUE_BYTES) {
      return rejection(
        'output_value_too_large',
        formatOutputSizeViolation({
          key,
          limitBytes: MAX_OUTPUT_VALUE_BYTES,
          measuredBytes: valueBytes,
          scope: 'value',
        }),
        {key, limitBytes: MAX_OUTPUT_VALUE_BYTES, measuredBytes: valueBytes},
      );
    }

    const totalBytes = totalOutputBytes({...this.#outputs, [key]: value});
    if (totalBytes > MAX_OUTPUT_TOTAL_BYTES) {
      return rejection(
        'output_total_too_large',
        formatOutputSizeViolation({
          limitBytes: MAX_OUTPUT_TOTAL_BYTES,
          measuredBytes: totalBytes,
          scope: 'total',
        }),
        {key, limitBytes: MAX_OUTPUT_TOTAL_BYTES, measuredBytes: totalBytes},
      );
    }

    const declaration = this.#declarations?.[key];
    if (declaration !== undefined) {
      const coerced = coerceSingleOutput(key, declaration, value);
      if (!coerced.ok) {
        return rejection(
          'output_schema_mismatch',
          feedbackForCoercionError(coerced.error, declaration),
          {
            key,
            ...(coerced.error.schemaError === undefined
              ? {}
              : {schemaError: coerced.error.schemaError}),
          },
        );
      }
    }

    this.#outputs[key] = value;
    return {ok: true};
  }

  missingRequired(): string[] {
    if (this.#declarations === undefined) return [];
    return Object.keys(this.#declarations).filter((key) => !Object.hasOwn(this.#outputs, key));
  }

  isComplete(): boolean {
    return this.missingRequired().length === 0;
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
      return rejection(
        'invalid_output_key',
        `Output key "${key}" is invalid. Use letters, numbers, underscores, or hyphens, ` +
          `and start with a letter or underscore.${declaredKeysFeedback(this.#declarations)}`,
        {key},
      );
    }

    if (this.#declarations !== undefined && !Object.hasOwn(this.#declarations, key)) {
      return rejection(
        'undeclared_output',
        `Output "${key}" is not declared by the step output schema.${declaredKeysFeedback(this.#declarations)}`,
        {key},
      );
    }

    return {ok: true};
  }
}

export async function runOutputTurnLoop(params: {
  signal: AbortSignal;
  prompt: string;
  runTurn: (prompt: string) => Promise<void>;
  missingRequired: () => string[];
  /** Additional runner-owned facts that must be complete before the turn can finish. */
  completionMissing?: () => readonly string[];
  guidanceForMissing?: (missing: readonly string[]) => string;
}): Promise<void> {
  let nextPrompt = params.prompt;
  for (let attempt = 0; attempt <= MAX_OUTPUT_REPROMPTS; attempt += 1) {
    if (params.signal.aborted) throw new Error('Agent step aborted');
    await params.runTurn(nextPrompt);
    if (params.signal.aborted) throw new Error('Agent step aborted');
    const missing = params.missingRequired();
    const completionMissing = params.completionMissing?.() ?? [];
    if (missing.length === 0 && completionMissing.length === 0) return;
    if (attempt === MAX_OUTPUT_REPROMPTS) {
      throw new RequiredOutputsMissingError([...missing, ...completionMissing]);
    }
    nextPrompt = nextPromptForMissing(params, missing, completionMissing);
  }
}

function nextPromptForMissing(
  params: {
    guidanceForMissing?: (missing: readonly string[]) => string;
  },
  missing: readonly string[],
  completionMissing: readonly string[],
): string {
  if (missing.length > 0) {
    const guidance = params.guidanceForMissing?.(missing);
    return (
      `The previous turn ended without setting required workflow outputs: ${missing.join(', ')}. ` +
      'Call set_output for each missing key, then provide your final response.' +
      (guidance === undefined ? '' : `\n\n${guidance}`)
    );
  }
  return (
    `The previous turn ended before satisfying runtime prerequisites: ${completionMissing.join(', ')}. ` +
    'Continue working until the prerequisites are satisfied, then provide your final response.'
  );
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

function rejection(
  code: OutputRejectionCode,
  feedback: string,
  details: Omit<OutputRejectionDetails, 'code'>,
): Extract<SetOutputResult, {readonly ok: false}> {
  return {ok: false, isError: true, code, feedback, details: {code, ...details}};
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
