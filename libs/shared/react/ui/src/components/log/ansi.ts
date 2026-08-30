/**
 * Minimal ANSI SGR (`ESC[…m`) parser for terminal output.
 *
 * It turns a raw output string into an ordered list of styled spans, mapping
 * the standard 16 foreground/background colors and the bold / dim / italic /
 * underline attributes onto the design-system palette so colors stay theme
 * consistent. Non-color escapes and unknown SGR codes are consumed, never
 * leaked into the rendered text. Extended color codes (`38;5;n`, `38;2;r;g;b`)
 * are parsed and skipped rather than mis-rendered.
 *
 * The parser is intentionally pure (no React) so `LogContent` can decide how
 * returned spans become elements.
 */

export interface AnsiSpan {
  text: string;
  /** Space-joined utility classes for the run; '' when unstyled. */
  className: string;
  /** Character offset of the run in the source string; a stable React key. */
  start: number;
}

interface AnsiStyle {
  fg?: string | undefined;
  bg?: string | undefined;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

const FOREGROUND: Record<number, string> = {
  30: 'text-neutral-500',
  31: 'text-red-400',
  32: 'text-green-400',
  33: 'text-orange-400',
  34: 'text-blue-400',
  35: 'text-purple-400',
  36: 'text-blue-300',
  37: 'text-neutral-200',
  90: 'text-neutral-400',
  91: 'text-red-300',
  92: 'text-green-300',
  93: 'text-orange-300',
  94: 'text-blue-300',
  95: 'text-purple-300',
  96: 'text-blue-200',
  97: 'text-neutral-0',
};

const BACKGROUND: Record<number, string> = {
  40: 'bg-neutral-500',
  41: 'bg-red-500',
  42: 'bg-green-500',
  43: 'bg-orange-500',
  44: 'bg-blue-500',
  45: 'bg-purple-500',
  46: 'bg-blue-400',
  47: 'bg-neutral-200',
  100: 'bg-neutral-400',
  101: 'bg-red-400',
  102: 'bg-green-400',
  103: 'bg-orange-400',
  104: 'bg-blue-400',
  105: 'bg-purple-400',
  106: 'bg-blue-300',
  107: 'bg-neutral-0',
};

const ESC = 0x1b;

export function parseAnsi(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let style: AnsiStyle = {};
  let textStart = 0;
  let i = 0;

  const flush = (end: number) => {
    if (end > textStart) {
      spans.push({
        text: input.slice(textStart, end),
        className: styleToClassName(style),
        start: textStart,
      });
    }
  };

  while (i < input.length) {
    if (input.charCodeAt(i) === ESC && input[i + 1] === '[') {
      const close = sgrTerminator(input, i + 2);
      if (close !== -1) {
        flush(i);
        style = applyCodes(style, input.slice(i + 2, close));
        i = close + 1;
        textStart = i;
        continue;
      }
    }
    i++;
  }

  flush(input.length);
  return spans;
}

/**
 * Returns the index of the `m` that closes an SGR sequence whose parameter
 * bytes start at `from`, or -1 when the run is not a well-formed SGR escape
 * (so the leading ESC is treated as ordinary text).
 */
function sgrTerminator(input: string, from: number): number {
  let i = from;
  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (code === 0x6d) return i; // 'm'
    // Parameter bytes are digits (0x30-0x39) and ';' (0x3b).
    if (code !== 0x3b && (code < 0x30 || code > 0x39)) return -1;
    i++;
  }
  return -1;
}

function applyCodes(style: AnsiStyle, raw: string): AnsiStyle {
  // An empty parameter list (`ESC[m`) is shorthand for reset.
  const codes = raw === '' ? [0] : raw.split(';').map((value) => Number.parseInt(value, 10));
  let next: AnsiStyle = {...style};

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === undefined) continue;
    switch (code) {
      case 0:
        next = {};
        break;
      case 1:
        next.bold = true;
        break;
      case 2:
        next.dim = true;
        break;
      case 3:
        next.italic = true;
        break;
      case 4:
        next.underline = true;
        break;
      case 22:
        next.bold = false;
        next.dim = false;
        break;
      case 23:
        next.italic = false;
        break;
      case 24:
        next.underline = false;
        break;
      case 39:
        next.fg = undefined;
        break;
      case 49:
        next.bg = undefined;
        break;
      case 38:
      case 48:
        clearExtendedColor(next, code);
        i += extendedColorOperandCount(codes[i + 1]);
        break;
      default:
        applyNamedAnsiColor(next, code);
    }
  }

  return next;
}

function clearExtendedColor(style: AnsiStyle, code: number): void {
  if (code === 38) style.fg = undefined;
  else style.bg = undefined;
}

function extendedColorOperandCount(mode: number | undefined): number {
  if (mode === 5) return 2;
  if (mode === 2) return 4;
  return 0;
}

function applyNamedAnsiColor(style: AnsiStyle, code: number): void {
  const foreground = FOREGROUND[code];
  if (foreground) {
    style.fg = foreground;
    return;
  }
  const background = BACKGROUND[code];
  if (background) style.bg = background;
}

function styleToClassName(style: AnsiStyle): string {
  const classes: string[] = [];
  if (style.fg) classes.push(style.fg);
  if (style.bg) classes.push(style.bg);
  if (style.bold) classes.push('font-bold');
  if (style.dim) classes.push('opacity-60');
  if (style.italic) classes.push('italic');
  if (style.underline) classes.push('underline');
  return classes.join(' ');
}
