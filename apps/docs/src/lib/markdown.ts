export function tableValue(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function inlineCode(value: string): string {
  return `\`${tableValue(value)}\``;
}
