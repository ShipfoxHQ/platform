import {
  assertBundledClaudeCodeVersion,
  isSupportedClaudeCodeVersion,
  MINIMUM_CLAUDE_CODE_VERSION,
  readBundledClaudeCodeVersion,
} from '#core/claude-code.js';

describe('Claude Code compatibility', () => {
  it('reports the version of the bundled Claude Code binary', () => {
    expect(() => assertBundledClaudeCodeVersion()).not.toThrow();
  });

  it.each([
    ['2.1.245', false],
    ['2.1.246', true],
    ['2.1.300', true],
    ['2.2.0', true],
    ['2.1.246-beta.1', false],
    ['2.1.246.1', false],
    ['not-a-version', false],
  ])('checks support for Claude Code %s', (version, supported) => {
    expect(isSupportedClaudeCodeVersion(version)).toBe(supported);
  });

  it('resolves the SDK binary through the SDK package directory', () => {
    let resolvedSpecifier: string | undefined;

    expect(
      readBundledClaudeCodeVersion({
        platform: 'darwin',
        arch: 'arm64',
        resolve: (specifier) => {
          resolvedSpecifier = specifier;
          return '/tmp/claude';
        },
        execute: () => '2.1.246 (Claude Code)',
      }),
    ).toBe('2.1.246');
    expect(resolvedSpecifier).toBe('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude');
  });

  it('tries the musl SDK binary after the glibc binary on Linux', () => {
    const resolvedSpecifiers: string[] = [];

    expect(
      readBundledClaudeCodeVersion({
        platform: 'linux',
        arch: 'x64',
        preferMusl: false,
        resolve: (specifier) => {
          resolvedSpecifiers.push(specifier);
          if (specifier.endsWith('-musl/claude')) return '/tmp/claude';
          throw new Error('glibc binary unavailable');
        },
        execute: () => '2.1.246 (Claude Code)',
      }),
    ).toBe('2.1.246');
    expect(resolvedSpecifiers).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-x64/claude',
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude',
    ]);
  });

  it('fails when the bundled binary reports an invalid version', () => {
    expect(() =>
      readBundledClaudeCodeVersion({
        resolve: () => '/tmp/claude',
        execute: () => 'Claude Code unavailable',
      }),
    ).toThrow('Unable to parse bundled Claude Code version');
  });

  it('fails when the bundled binary is older than the minimum', () => {
    expect(() =>
      assertBundledClaudeCodeVersion({
        resolve: () => '/tmp/claude',
        execute: () => '2.1.245 (Claude Code)',
      }),
    ).toThrow(`requires ${MINIMUM_CLAUDE_CODE_VERSION} or newer`);
  });
});
