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

export function scanShellLiteral(text: string, state: ShellScanState): ShellScanState {
  const frames = state.frames.map(cloneShellScanFrame);
  let pendingEscape = state.pendingEscape ?? false;
  let previousCharacter = state.previousCharacter;
  let previousCharacterEscaped = state.previousCharacterEscaped ?? false;
  let index = 0;

  function advance(nextIndex: number, escaped: boolean): void {
    if (nextIndex > index) {
      previousCharacter = text[nextIndex - 1];
      previousCharacterEscaped = escaped;
    }
    index = nextIndex;
  }

  function consumeShellEscape(): void {
    const result = skipShellEscape(text, index);
    pendingEscape = result.pendingEscape;
    if (result.continuedLine) {
      index = result.index;
      return;
    }

    advance(result.index, result.consumedEscapedCharacter);
  }

  while (index < text.length) {
    if (pendingEscape) {
      pendingEscape = false;
      advance(index + 1, true);
      continue;
    }

    const frame = topFrame(frames);

    if (frame === 'single') {
      if (text[index] === "'") frames.pop();
      advance(index + 1, false);
      continue;
    }

    if (frame === 'dollar-single') {
      if (text[index] === '\\') {
        consumeShellEscape();
        continue;
      }

      if (text[index] === "'") frames.pop();
      advance(index + 1, false);
      continue;
    }

    if (frame === 'backtick') {
      if (text[index] === '\\') {
        consumeShellEscape();
        continue;
      }

      if (text[index] === '`') {
        frames.pop();
        advance(index + 1, false);
        continue;
      }

      advance(scanShellControlStart(text, index, frames), false);
      continue;
    }

    if (frame === 'double' || frame === 'dollar-double') {
      if (text[index] === '\\') {
        consumeShellEscape();
        continue;
      }

      if (text[index] === '"') {
        frames.pop();
        advance(index + 1, false);
        continue;
      }

      if (text[index] === '`') {
        frames.push('backtick');
        advance(index + 1, false);
        continue;
      }

      advance(scanShellControlStart(text, index, frames), false);
      continue;
    }

    if (frame === 'param-brace') {
      if (text[index] === '\\') {
        consumeShellEscape();
        continue;
      }

      if (text[index] === '}') {
        frames.pop();
        advance(index + 1, false);
        continue;
      }

      if (text[index] === '`') {
        frames.push('backtick');
        advance(index + 1, false);
        continue;
      }

      advance(scanShellControlStart(text, index, frames), false);
      continue;
    }

    if (frame === 'paren-sub') {
      if (text[index] === '\\') {
        consumeShellEscape();
        continue;
      }

      if (text[index] === ')') {
        frames.pop();
        advance(index + 1, false);
        continue;
      }

      advance(
        scanShellPlainStart(text, index, frames, previousCharacter, previousCharacterEscaped),
        false,
      );
      continue;
    }

    if (isArithFrame(frame)) {
      const arithEnd = matchShellLogicalPrefix(text, index, '))');
      if (frame.parenthesisDepth === 0 && arithEnd !== undefined) {
        frames.pop();
        advance(arithEnd, false);
        continue;
      }

      if (text[index] === ')') {
        replaceTopArithFrame(frames, Math.max(0, frame.parenthesisDepth - 1));
        advance(index + 1, false);
        continue;
      }

      if (text[index] === '(') {
        replaceTopArithFrame(frames, frame.parenthesisDepth + 1);
        advance(index + 1, false);
        continue;
      }

      if (text[index] === '\\') {
        consumeShellEscape();
        continue;
      }

      advance(
        scanShellPlainStart(text, index, frames, previousCharacter, previousCharacterEscaped),
        false,
      );
      continue;
    }

    if (frame === 'heredoc') {
      advance(index + 1, false);
      continue;
    }

    if (frame === 'line-comment') {
      if (text[index] === '\n') frames.pop();
      advance(index + 1, false);
      continue;
    }

    if (isArithSquareFrame(frame)) {
      if (text[index] === '[') {
        replaceTopArithSquareFrame(frames, frame.bracketDepth + 1);
        advance(index + 1, false);
        continue;
      }

      if (text[index] === ']') {
        if (frame.bracketDepth === 0) {
          frames.pop();
        } else {
          replaceTopArithSquareFrame(frames, frame.bracketDepth - 1);
        }
        advance(index + 1, false);
        continue;
      }

      if (text[index] === '\\') {
        consumeShellEscape();
        continue;
      }

      advance(
        scanShellPlainStart(text, index, frames, previousCharacter, previousCharacterEscaped),
        false,
      );
      continue;
    }

    if (text[index] === '\\') {
      consumeShellEscape();
      continue;
    }

    advance(
      scanShellPlainStart(text, index, frames, previousCharacter, previousCharacterEscaped),
      false,
    );
  }

  return {
    frames,
    ...(pendingEscape ? {pendingEscape} : {}),
    ...(previousCharacter === undefined ? {} : {previousCharacter}),
    ...(previousCharacterEscaped ? {previousCharacterEscaped} : {}),
  };
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
