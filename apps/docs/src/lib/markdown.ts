const WHITESPACE_ONLY_PATTERN = /^ +$/;
const CODE_SPAN_PADDING_PATTERN = /^(?:\s|`)|(?:\s|`)$/u;

export function tableValue(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function inlineCode(value: string): string {
  const content = tableValue(value);
  const maxBacktickRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), ([run]) => run.length));
  const delimiter = '`'.repeat(maxBacktickRun + 1);
  const needsPadding =
    content.length > 0 &&
    !WHITESPACE_ONLY_PATTERN.test(content) &&
    CODE_SPAN_PADDING_PATTERN.test(content);
  const padding = needsPadding ? ' ' : '';
  return `${delimiter}${padding}${content}${padding}${delimiter}`;
}
