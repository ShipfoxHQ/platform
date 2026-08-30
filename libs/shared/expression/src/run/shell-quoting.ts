export type ShellFrame =
  | 'single'
  | 'double'
  | 'dollar-single'
  | 'dollar-double'
  | 'paren-sub'
  | 'arith'
  | 'backtick'
  | 'param-brace'
  | 'heredoc'
  | 'line-comment';

export type ShellUnsafeRegion = ShellFrame | 'escape';
interface ArithSquareFrame {
  readonly kind: 'arith-square';
  readonly bracketDepth: number;
}
interface ArithFrame {
  readonly kind: 'arith';
  readonly parenthesisDepth: number;
}
type ShellScanFrame = Exclude<ShellFrame, 'arith'> | ArithFrame | ArithSquareFrame;

export type ShellSiteContext =
  | {readonly kind: 'unquoted' | 'single' | 'double'}
  | {readonly kind: 'unsafe'; readonly region: ShellUnsafeRegion};

export interface ShellScanState {
  readonly frames: readonly ShellScanFrame[];
  readonly pendingEscape?: boolean;
  readonly previousCharacter?: string;
  readonly previousCharacterEscaped?: boolean;
}

export const initialShellScanState: ShellScanState = {frames: []};

const shellCommentStarterPrefixPattern = /\s|[;&|()<>]/;

interface ShellLiteralScanContext {
  readonly text: string;
  readonly frames: ShellScanFrame[];
  index: number;
  pendingEscape: boolean;
  previousCharacter: string | undefined;
  previousCharacterEscaped: boolean;
}

type ShellFrameKind = ShellFrame | 'arith' | 'arith-square' | 'plain';

export function scanShellLiteral(text: string, state: ShellScanState): ShellScanState {
  const context: ShellLiteralScanContext = {
    text,
    frames: state.frames.map(cloneShellScanFrame),
    index: 0,
    pendingEscape: state.pendingEscape ?? false,
    previousCharacter: state.previousCharacter,
    previousCharacterEscaped: state.previousCharacterEscaped ?? false,
  };

  while (context.index < text.length) scanNextShellCharacter(context);

  return {
    frames: context.frames,
    ...(context.pendingEscape ? {pendingEscape: true} : {}),
    ...(context.previousCharacter === undefined
      ? {}
      : {previousCharacter: context.previousCharacter}),
    ...(context.previousCharacterEscaped ? {previousCharacterEscaped: true} : {}),
  };
}

function scanNextShellCharacter(context: ShellLiteralScanContext): void {
  if (context.pendingEscape) {
    context.pendingEscape = false;
    advanceShellScan(context, context.index + 1, true);
    return;
  }

  const frame = topFrame(context.frames);
  switch (shellFrameKind(frame)) {
    case 'single':
      scanSingleFrame(context);
      return;
    case 'dollar-single':
      scanDollarSingleFrame(context);
      return;
    case 'backtick':
      scanBacktickFrame(context);
      return;
    case 'double':
    case 'dollar-double':
      scanDoubleFrame(context);
      return;
    case 'param-brace':
      scanParameterBraceFrame(context);
      return;
    case 'paren-sub':
      scanParenthesisSubstitutionFrame(context);
      return;
    case 'arith':
      scanArithmeticFrame(context, frame);
      return;
    case 'arith-square':
      scanArithmeticSquareFrame(context, frame);
      return;
    case 'heredoc':
      advanceShellScan(context, context.index + 1, false);
      return;
    case 'line-comment':
      scanLineCommentFrame(context);
      return;
    case 'plain':
      scanPlainFrame(context);
      return;
  }
}

function shellFrameKind(frame: ShellScanFrame | undefined): ShellFrameKind {
  if (isArithFrame(frame)) return 'arith';
  if (isArithSquareFrame(frame)) return 'arith-square';
  return frame ?? 'plain';
}

function advanceShellScan(
  context: ShellLiteralScanContext,
  nextIndex: number,
  escaped: boolean,
): void {
  if (nextIndex > context.index) {
    context.previousCharacter = context.text[nextIndex - 1];
    context.previousCharacterEscaped = escaped;
  }
  context.index = nextIndex;
}

function consumeShellEscape(context: ShellLiteralScanContext): void {
  const result = skipShellEscape(context.text, context.index);
  context.pendingEscape = result.pendingEscape;
  if (result.continuedLine) {
    context.index = result.index;
    return;
  }
  advanceShellScan(context, result.index, result.consumedEscapedCharacter);
}

function scanSingleFrame(context: ShellLiteralScanContext): void {
  if (context.text[context.index] === "'") context.frames.pop();
  advanceShellScan(context, context.index + 1, false);
}

function scanDollarSingleFrame(context: ShellLiteralScanContext): void {
  if (context.text[context.index] === '\\') {
    consumeShellEscape(context);
    return;
  }
  scanSingleFrame(context);
}

function scanBacktickFrame(context: ShellLiteralScanContext): void {
  if (context.text[context.index] === '\\') {
    consumeShellEscape(context);
    return;
  }
  if (context.text[context.index] === '`') {
    context.frames.pop();
    advanceShellScan(context, context.index + 1, false);
    return;
  }
  scanControlStart(context);
}

function scanDoubleFrame(context: ShellLiteralScanContext): void {
  if (context.text[context.index] === '\\') {
    consumeShellEscape(context);
    return;
  }
  if (context.text[context.index] === '"') {
    context.frames.pop();
    advanceShellScan(context, context.index + 1, false);
    return;
  }
  if (context.text[context.index] === '`') {
    context.frames.push('backtick');
    advanceShellScan(context, context.index + 1, false);
    return;
  }
  scanControlStart(context);
}

function scanParameterBraceFrame(context: ShellLiteralScanContext): void {
  if (context.text[context.index] === '\\') {
    consumeShellEscape(context);
    return;
  }
  if (context.text[context.index] === '}') {
    context.frames.pop();
    advanceShellScan(context, context.index + 1, false);
    return;
  }
  if (context.text[context.index] === '`') {
    context.frames.push('backtick');
    advanceShellScan(context, context.index + 1, false);
    return;
  }
  scanControlStart(context);
}

function scanParenthesisSubstitutionFrame(context: ShellLiteralScanContext): void {
  if (context.text[context.index] === '\\') {
    consumeShellEscape(context);
    return;
  }
  if (context.text[context.index] === ')') {
    context.frames.pop();
    advanceShellScan(context, context.index + 1, false);
    return;
  }
  scanPlainStart(context);
}

function scanArithmeticFrame(
  context: ShellLiteralScanContext,
  frame: ArithFrame | ShellScanFrame | undefined,
): void {
  if (!isArithFrame(frame)) return;
  const arithEnd = matchShellLogicalPrefix(context.text, context.index, '))');
  if (frame.parenthesisDepth === 0 && arithEnd !== undefined) {
    context.frames.pop();
    advanceShellScan(context, arithEnd, false);
    return;
  }
  if (context.text[context.index] === ')') {
    replaceTopArithFrame(context.frames, Math.max(0, frame.parenthesisDepth - 1));
    advanceShellScan(context, context.index + 1, false);
    return;
  }
  if (context.text[context.index] === '(') {
    replaceTopArithFrame(context.frames, frame.parenthesisDepth + 1);
    advanceShellScan(context, context.index + 1, false);
    return;
  }
  if (context.text[context.index] === '\\') {
    consumeShellEscape(context);
    return;
  }
  scanPlainStart(context);
}

function scanArithmeticSquareFrame(
  context: ShellLiteralScanContext,
  frame: ArithSquareFrame | ShellScanFrame | undefined,
): void {
  if (!isArithSquareFrame(frame)) return;
  if (context.text[context.index] === '[') {
    replaceTopArithSquareFrame(context.frames, frame.bracketDepth + 1);
    advanceShellScan(context, context.index + 1, false);
    return;
  }
  if (context.text[context.index] === ']') {
    closeArithmeticSquareFrame(context, frame);
    return;
  }
  if (context.text[context.index] === '\\') {
    consumeShellEscape(context);
    return;
  }
  scanPlainStart(context);
}

function closeArithmeticSquareFrame(
  context: ShellLiteralScanContext,
  frame: ArithSquareFrame,
): void {
  if (frame.bracketDepth === 0) context.frames.pop();
  else replaceTopArithSquareFrame(context.frames, frame.bracketDepth - 1);
  advanceShellScan(context, context.index + 1, false);
}

function scanLineCommentFrame(context: ShellLiteralScanContext): void {
  if (context.text[context.index] === '\n') context.frames.pop();
  advanceShellScan(context, context.index + 1, false);
}

function scanPlainFrame(context: ShellLiteralScanContext): void {
  if (context.text[context.index] === '\\') {
    consumeShellEscape(context);
    return;
  }
  scanPlainStart(context);
}

function scanPlainStart(context: ShellLiteralScanContext): void {
  const nextIndex = scanShellPlainStart(
    context.text,
    context.index,
    context.frames,
    context.previousCharacter,
    context.previousCharacterEscaped,
  );
  advanceShellScan(context, nextIndex, false);
}

function scanControlStart(context: ShellLiteralScanContext): void {
  const nextIndex = scanShellControlStart(context.text, context.index, context.frames);
  advanceShellScan(context, nextIndex, false);
}

export function classifyShellSite(state: ShellScanState): ShellSiteContext {
  if (state.pendingEscape === true) return {kind: 'unsafe', region: 'escape'};
  if (state.frames.length === 0) return {kind: 'unquoted'};
  if (state.frames.length === 1 && state.frames[0] === 'single') return {kind: 'single'};
  if (state.frames.length === 1 && state.frames[0] === 'double') return {kind: 'double'};

  return {kind: 'unsafe', region: findUnsafeRegion(state.frames)};
}

function scanShellPlainStart(
  text: string,
  index: number,
  frames: ShellScanFrame[],
  previousCharacter: string | undefined,
  previousCharacterEscaped: boolean,
): number {
  if (startsShellLineComment(text, index, previousCharacter, previousCharacterEscaped)) {
    frames.push('line-comment');
    return index + 1;
  }

  const heredocStripTabsStart = matchShellLogicalPrefix(text, index, '<<-');
  if (heredocStripTabsStart !== undefined) {
    frames.push('heredoc');
    return heredocStripTabsStart;
  }

  const heredocStart = matchShellLogicalPrefix(text, index, '<<');
  if (heredocStart !== undefined) {
    frames.push('heredoc');
    return heredocStart;
  }

  const dollarArithStart = matchShellLogicalPrefix(text, index, '$((');
  if (dollarArithStart !== undefined) {
    frames.push({kind: 'arith', parenthesisDepth: 0});
    return dollarArithStart;
  }

  const arithSquareStart = matchShellLogicalPrefix(text, index, '$[');
  if (arithSquareStart !== undefined) {
    frames.push({kind: 'arith-square', bracketDepth: 0});
    return arithSquareStart;
  }

  const parenSubStart = matchShellLogicalPrefix(text, index, '$(');
  if (parenSubStart !== undefined) {
    frames.push('paren-sub');
    return parenSubStart;
  }

  const paramBraceStart = matchShellLogicalPrefix(text, index, '${');
  if (paramBraceStart !== undefined) {
    frames.push('param-brace');
    return paramBraceStart;
  }

  const dollarSingleStart = matchShellLogicalPrefix(text, index, "$'");
  if (dollarSingleStart !== undefined) {
    frames.push('dollar-single');
    return dollarSingleStart;
  }

  const dollarDoubleStart = matchShellLogicalPrefix(text, index, '$"');
  if (dollarDoubleStart !== undefined) {
    frames.push('dollar-double');
    return dollarDoubleStart;
  }

  const arithStart = matchShellLogicalPrefix(text, index, '((');
  if (arithStart !== undefined) {
    frames.push({kind: 'arith', parenthesisDepth: 0});
    return arithStart;
  }

  if (text[index] === "'") {
    frames.push('single');
    return index + 1;
  }

  if (text[index] === '"') {
    frames.push('double');
    return index + 1;
  }

  if (text[index] === '`') {
    frames.push('backtick');
    return index + 1;
  }

  return index + 1;
}

function scanShellControlStart(text: string, index: number, frames: ShellScanFrame[]): number {
  const dollarArithStart = matchShellLogicalPrefix(text, index, '$((');
  if (dollarArithStart !== undefined) {
    frames.push({kind: 'arith', parenthesisDepth: 0});
    return dollarArithStart;
  }

  const arithSquareStart = matchShellLogicalPrefix(text, index, '$[');
  if (arithSquareStart !== undefined) {
    frames.push({kind: 'arith-square', bracketDepth: 0});
    return arithSquareStart;
  }

  const parenSubStart = matchShellLogicalPrefix(text, index, '$(');
  if (parenSubStart !== undefined) {
    frames.push('paren-sub');
    return parenSubStart;
  }

  const paramBraceStart = matchShellLogicalPrefix(text, index, '${');
  if (paramBraceStart !== undefined) {
    frames.push('param-brace');
    return paramBraceStart;
  }

  const dollarSingleStart = matchShellLogicalPrefix(text, index, "$'");
  if (dollarSingleStart !== undefined) {
    frames.push('dollar-single');
    return dollarSingleStart;
  }

  const dollarDoubleStart = matchShellLogicalPrefix(text, index, '$"');
  if (dollarDoubleStart !== undefined) {
    frames.push('dollar-double');
    return dollarDoubleStart;
  }

  return index + 1;
}

function matchShellLogicalPrefix(text: string, index: number, prefix: string): number | undefined {
  let nextIndex = index;

  for (let prefixIndex = 0; prefixIndex < prefix.length; prefixIndex += 1) {
    if (text[nextIndex] !== prefix[prefixIndex]) return undefined;
    nextIndex += 1;
    if (prefixIndex + 1 < prefix.length) nextIndex = skipShellLineContinuations(text, nextIndex);
  }

  return nextIndex;
}

function skipShellLineContinuations(text: string, index: number): number {
  let nextIndex = index;

  while (text[nextIndex] === '\\' && text[nextIndex + 1] === '\n') {
    nextIndex += 2;
  }

  return nextIndex;
}

function skipShellEscape(
  text: string,
  index: number,
): {
  readonly index: number;
  readonly pendingEscape: boolean;
  readonly consumedEscapedCharacter: boolean;
  readonly continuedLine: boolean;
} {
  if (index + 1 >= text.length) {
    return {
      index: text.length,
      pendingEscape: true,
      consumedEscapedCharacter: false,
      continuedLine: false,
    };
  }

  return {
    index: index + 2,
    pendingEscape: false,
    consumedEscapedCharacter: true,
    continuedLine: text[index + 1] === '\n',
  };
}

function topFrame(frames: readonly ShellScanFrame[]): ShellScanFrame | undefined {
  return frames.at(-1);
}

function cloneShellScanFrame(frame: ShellScanFrame): ShellScanFrame {
  if (isArithSquareFrame(frame) || isArithFrame(frame)) return {...frame};
  return frame;
}

function findUnsafeRegion(frames: readonly ShellScanFrame[]): ShellFrame {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (frame === undefined) continue;
    if (isArithSquareFrame(frame)) return 'arith';
    if (isArithFrame(frame)) return 'arith';
    if (frame !== 'single' && frame !== 'double') return frame;
  }

  return 'heredoc';
}

function isArithSquareFrame(frame: ShellScanFrame | undefined): frame is ArithSquareFrame {
  return typeof frame === 'object' && frame.kind === 'arith-square';
}

function isArithFrame(frame: ShellScanFrame | undefined): frame is ArithFrame {
  return typeof frame === 'object' && frame.kind === 'arith';
}

function replaceTopArithFrame(frames: ShellScanFrame[], parenthesisDepth: number): void {
  const topIndex = frames.length - 1;
  const frame = frames[topIndex];
  if (isArithFrame(frame)) frames[topIndex] = {...frame, parenthesisDepth};
}

function replaceTopArithSquareFrame(frames: ShellScanFrame[], bracketDepth: number): void {
  const topIndex = frames.length - 1;
  const frame = frames[topIndex];
  if (isArithSquareFrame(frame)) frames[topIndex] = {...frame, bracketDepth};
}

function startsShellLineComment(
  text: string,
  index: number,
  previousCharacter: string | undefined,
  previousCharacterEscaped: boolean,
): boolean {
  if (text[index] !== '#') return false;
  if (previousCharacterEscaped) return false;
  if (previousCharacter === undefined) return true;

  return shellCommentStarterPrefixPattern.test(previousCharacter);
}
