// @ts-expect-error Node built-ins are available in the Vitest Node environment but not part of the UI package's browser type surface.
import {readFileSync} from 'node:fs';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

const SEMICOLON_PATTERN = /;$/;
const TOKEN_REFERENCE_PATTERN = /^var\((--[\w-]+)\)$/;
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('\n.dark {'));
const darkBlock = css.slice(css.indexOf('\n.dark {'), css.indexOf('\n@theme inline {'));

describe('surface tokens', () => {
  test('keeps the light ladder opaque and stepped', () => {
    expect(resolveToken(rootBlock, '--background-subtle-base')).toBe('#fafafa');
    expect(resolveToken(rootBlock, '--background-components-base')).toBe('#f4f4f5');
    expect(resolveToken(rootBlock, '--background-components-hover')).toBe('#e4e4e7');
    expect(resolveToken(rootBlock, '--background-components-pressed')).toBe('#d4d4d8');
  });

  test('preserves the dark ladder definitions', () => {
    expect(resolveToken(darkBlock, '--background-subtle-base')).toBe('#0f0f10');
    expect(resolveToken(darkBlock, '--background-components-base')).toBe('#27272a');
    expect(resolveToken(darkBlock, '--background-components-hover')).toBe(
      'rgba(255, 255, 255, 0.1)',
    );
    expect(resolveToken(darkBlock, '--background-components-pressed')).toBe(
      'rgba(255, 255, 255, 0.16)',
    );
  });
});

function readToken(block: string, token: string) {
  const line = block.split('\n').find((candidate) => candidate.trimStart().startsWith(`${token}:`));

  if (!line) {
    throw new Error(`Missing token ${token}`);
  }

  return line
    .slice(line.indexOf(':') + 1)
    .trim()
    .replace(SEMICOLON_PATTERN, '');
}

function resolveToken(block: string, token: string) {
  const value = readToken(block, token);
  const reference = value.match(TOKEN_REFERENCE_PATTERN)?.[1];

  return reference ? readToken(rootBlock, reference) : value;
}
