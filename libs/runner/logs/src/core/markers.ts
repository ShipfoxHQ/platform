/** A recognised GitHub Actions group marker, derived from one captured line. */
export type MarkerEvent = {kind: 'group_start'; name: string} | {kind: 'group_end'};

const GROUP_START_PREFIX = '::group::';
const GROUP_END_LINE = '::endgroup::';

/**
 * Recognises GitHub Actions group markers in a single captured line (the line content,
 * with or without a trailing CR/LF). `::group::<name>` and `::endgroup::` are the only two;
 * everything else returns undefined and stays normal output.
 *
 * The `::` must start the line: GitHub treats workflow commands as line-leading, so a `::`
 * mid-line or after whitespace is plain text. `::endgroup::` must match exactly, so a
 * trailing argument (`::endgroup:: x`) is not a marker. The name is returned verbatim;
 * secret masking and the DTO's byte cap are applied downstream (the transform masks it, the
 * framer truncates it), so this stays a pure, side-effect-free parser.
 */
export function parseMarker(line: string): MarkerEvent | undefined {
  const content = stripLineEnding(line);
  if (content === GROUP_END_LINE) return {kind: 'group_end'};
  if (content.startsWith(GROUP_START_PREFIX)) {
    return {kind: 'group_start', name: content.slice(GROUP_START_PREFIX.length)};
  }
  return undefined;
}

/**
 * Whether an unterminated line prefix could still become a marker once more bytes arrive.
 * The transform uses this to hold a `::`-leading partial line until its newline (so the
 * marker can be swallowed) while streaming all other output live. Returns false as soon as
 * the prefix diverges from both markers, so a `::not-a-marker` line stops being held after
 * three characters.
 */
export function couldBeMarker(linePrefix: string): boolean {
  // A CRLF marker reaches here as `...\r` one byte before its `\n`. Treat a trailing CR as
  // not-yet-divergent so a split `::endgroup::\r` keeps being held until the `\n` that
  // completes and swallows it, instead of being released as an output line.
  const prefix = linePrefix.endsWith('\r') ? linePrefix.slice(0, -1) : linePrefix;
  return (
    GROUP_START_PREFIX.startsWith(prefix) ||
    prefix.startsWith(GROUP_START_PREFIX) ||
    GROUP_END_LINE.startsWith(prefix)
  );
}

// Drops a single trailing LF and/or CR so a CRLF line and an already-split line both match.
function stripLineEnding(line: string): string {
  let end = line.length;
  if (end > 0 && line[end - 1] === '\n') end--;
  if (end > 0 && line[end - 1] === '\r') end--;
  return line.slice(0, end);
}
