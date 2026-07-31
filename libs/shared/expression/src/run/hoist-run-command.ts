import type {ResolvedField, ResolvedFieldDeferredSegment} from '../plan/resolved-field.js';
import {
  classifyShellSite,
  initialShellScanState,
  type ShellScanState,
  type ShellSiteContext,
  type ShellUnsafeRegion,
  scanShellLiteral,
} from './shell-quoting.js';

export const unsafeRunInterpolationErrorCode = 'unsafe-run-interpolation';

const generatedNamePrefix = '__sf_';
const shellIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface RunCommandHoistOptions {
  readonly reservedNames?: Iterable<string>;
}

export interface PlannedRunCommandBinding {
  readonly name: string;
  readonly segment: ResolvedFieldDeferredSegment;
}

export interface HoistedPlannedRunCommand {
  readonly command: string;
  readonly bindings: readonly PlannedRunCommandBinding[];
}

export interface UnsafeRunInterpolation {
  readonly region: ShellUnsafeRegion;
  readonly source: string;
}

export class UnsafeRunInterpolationError extends Error {
  readonly code = unsafeRunInterpolationErrorCode;
  readonly occurrences: readonly UnsafeRunInterpolation[];
  readonly partial: HoistedPlannedRunCommand | undefined;
  readonly region: ShellUnsafeRegion;
  readonly source: string;

  constructor(params: {
    readonly region: ShellUnsafeRegion;
    readonly source: string;
    readonly occurrences?: readonly UnsafeRunInterpolation[];
    readonly partial?: HoistedPlannedRunCommand;
  }) {
    super(
      `Unsafe run interpolation inside ${params.region}. Bind the value to env and reference $VAR instead.`,
    );
    this.name = 'UnsafeRunInterpolationError';
    this.occurrences = params.occurrences ?? [{region: params.region, source: params.source}];
    this.partial = params.partial;
    this.region = params.region;
    this.source = params.source;
  }
}

/**
 * Hoists unfilled planned run-command segments into generated shell env
 * references. Literal segments are trusted authored shell text; only call this
 * on planned command fields that have not already been filled.
 */
export function hoistPlannedRunCommand(params: {
  readonly field: ResolvedField;
  readonly reservedNames?: Iterable<string>;
}): HoistedPlannedRunCommand {
  const result = hoistCommandSegments({
    segments: params.field.segments,
    options: params.reservedNames === undefined ? {} : {reservedNames: params.reservedNames},
    literalText: (segment) => segment.value,
    isBindingSegment: (segment): segment is ResolvedFieldDeferredSegment =>
      segment.kind === 'deferred',
  });

  const firstUnsafeInterpolation = result.unsafeInterpolations[0];
  if (firstUnsafeInterpolation !== undefined) {
    throw new UnsafeRunInterpolationError({
      ...firstUnsafeInterpolation,
      occurrences: result.unsafeInterpolations,
      partial: {command: result.command, bindings: result.bindings},
    });
  }

  return {command: result.command, bindings: result.bindings};
}

function hoistCommandSegments<
  Segment extends {readonly kind: string},
  BindingSegment extends Segment & {readonly expression: {readonly source: string}},
>(params: {
  readonly segments: readonly Segment[];
  readonly options: RunCommandHoistOptions;
  readonly literalText: (segment: Extract<Segment, {readonly kind: 'literal'}>) => string;
  readonly isBindingSegment: (segment: Segment) => segment is BindingSegment;
}): {
  readonly command: string;
  readonly bindings: readonly {readonly name: string; readonly segment: BindingSegment}[];
  readonly unsafeInterpolations: readonly UnsafeRunInterpolation[];
} {
  let command = '';
  let state: ShellScanState = initialShellScanState;
  const bindings: {name: string; segment: BindingSegment}[] = [];
  const unsafeInterpolations: UnsafeRunInterpolation[] = [];
  const reservedNames = new Set(params.options.reservedNames ?? []);
  let nextIndex = 0;

  for (const segment of params.segments) {
    if (segment.kind === 'literal') {
      const text = params.literalText(segment as Extract<Segment, {readonly kind: 'literal'}>);
      command += text;
      state = scanShellLiteral(text, state);
      continue;
    }

    if (!params.isBindingSegment(segment)) continue;

    const site = classifyShellSite(state);
    if (site.kind === 'unsafe') {
      unsafeInterpolations.push({
        region: site.region,
        source: segment.expression.source,
      });
      continue;
    }

    const name = nextGeneratedName(reservedNames, nextIndex);
    nextIndex = Number(name.slice(generatedNamePrefix.length)) + 1;
    reservedNames.add(name);
    bindings.push({name, segment});
    command += shellReference(name, site);
  }

  return {command, bindings, unsafeInterpolations};
}

function nextGeneratedName(reservedNames: ReadonlySet<string>, startIndex: number): string {
  let index = startIndex;

  while (true) {
    const name = `${generatedNamePrefix}${index}`;
    if (!shellIdentifierPattern.test(name)) {
      throw new Error(`Generated run env name is not a shell identifier: ${name}`);
    }

    if (!reservedNames.has(name)) return name;
    index += 1;
  }
}

function shellReference(name: string, site: Exclude<ShellSiteContext, {readonly kind: 'unsafe'}>) {
  if (site.kind === 'double') return `\${${name}}`;
  if (site.kind === 'single') return `'"\${${name}}"'`;
  return `"\${${name}}"`;
}
