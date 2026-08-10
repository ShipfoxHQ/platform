/// <reference types="node" />

import {readFileSync} from 'node:fs';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

describe('surface token contract', () => {
  test('keeps the canvas opaque and removes the retired background token', () => {
    expect(css).toContain('--background-subtle-base: var(--color-neutral-50);');
    expect(css).toContain('--background-subtle-base: var(--color-neutral-950);');
    expect(css).not.toContain('--background-subtle-base: var(--color-alpha-');
    expect(css).not.toContain('background-neutral-background');
  });
});
