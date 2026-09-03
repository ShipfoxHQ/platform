import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const CLAUDE_AGENT_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';
const MINIMUM_CLAUDE_CODE_VERSION_PARTS = [2, 1, 246] as const;
const CLAUDE_CODE_VERSION_PATTERN = /\b(\d+)\.(\d+)\.(\d+)\b/u;
const require = createRequire(import.meta.url);

export const MINIMUM_CLAUDE_CODE_VERSION = MINIMUM_CLAUDE_CODE_VERSION_PARTS.join('.');

type ClaudeCodeVersion = readonly [number, number, number];
type PackageResolver = (specifier: string) => string;
type ClaudeCodeExecutor = (executable: string) => string;

type ClaudeCodeCheckParams = {
  resolve?: PackageResolver;
  execute?: ClaudeCodeExecutor;
  platform?: NodeJS.Platform;
  arch?: string;
  preferMusl?: boolean;
};

/**
 * Verifies that the Claude Code binary bundled by the Agent SDK meets the runner's minimum
 * version. This runs against the deployed production closure during runner image builds.
 */
export function assertBundledClaudeCodeVersion(params: ClaudeCodeCheckParams = {}): void {
  const version = readBundledClaudeCodeVersion(params);
  if (isSupportedClaudeCodeVersion(version)) return;

  throw new Error(
    `Bundled Claude Code version ${version} is not supported; requires ${MINIMUM_CLAUDE_CODE_VERSION} or newer.`,
  );
}

export function readBundledClaudeCodeVersion(params: ClaudeCodeCheckParams = {}): string {
  const executable = resolveBundledClaudeCodeExecutable(params);
  let output: string;

  try {
    output = (params.execute ?? executeClaudeCode)(executable);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to execute bundled Claude Code at "${executable}": ${reason}`);
  }

  const version = parseClaudeCodeVersion(output);
  if (version === undefined) {
    const reportedOutput = output.trim().replace(/\s+/gu, ' ');
    throw new Error(
      `Unable to parse bundled Claude Code version from "${reportedOutput}"; expected a semantic version.`,
    );
  }

  return formatClaudeCodeVersion(version);
}

export function isSupportedClaudeCodeVersion(version: string): boolean {
  const parsedVersion = parseClaudeCodeVersion(version);
  return (
    parsedVersion !== undefined &&
    compareClaudeCodeVersions(parsedVersion, MINIMUM_CLAUDE_CODE_VERSION_PARTS) >= 0
  );
}

function resolveBundledClaudeCodeExecutable(params: ClaudeCodeCheckParams): string {
  const platform = params.platform ?? process.platform;
  const arch = params.arch ?? process.arch;
  const specifiers = claudeCodeBinarySpecifiers({
    platform,
    arch,
    ...(params.preferMusl === undefined ? {} : {preferMusl: params.preferMusl}),
  });
  const resolve = params.resolve ?? sdkPackageResolver();
  const reasons: string[] = [];

  for (const specifier of specifiers) {
    try {
      return resolve(specifier);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }

  const detail = reasons.length === 0 ? '' : ` ${reasons.join(' ')}`;
  throw new Error(
    `Unable to resolve bundled Claude Code for ${platform}-${arch}; tried ${specifiers.join(', ')}.${detail}`,
  );
}

function sdkPackageResolver(): PackageResolver {
  let sdkEntry: string;
  try {
    sdkEntry = require.resolve(CLAUDE_AGENT_SDK_PACKAGE);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to resolve Claude Agent SDK package: ${reason}`);
  }

  const sdkRequire = createRequire(sdkEntry);
  return (specifier) => sdkRequire.resolve(specifier);
}

function claudeCodeBinarySpecifiers(params: {
  platform: NodeJS.Platform;
  arch: string;
  preferMusl?: boolean;
}): string[] {
  const {platform, arch} = params;
  const binary = platform === 'win32' ? 'claude.exe' : 'claude';

  if (platform === 'android') {
    return [`${CLAUDE_AGENT_SDK_PACKAGE}-linux-${arch}-android/${binary}`];
  }

  if (platform === 'linux') {
    const libcSuffixes = (params.preferMusl ?? prefersMusl()) ? ['-musl', ''] : ['', '-musl'];
    return libcSuffixes.map(
      (suffix) => `${CLAUDE_AGENT_SDK_PACKAGE}-linux-${arch}${suffix}/${binary}`,
    );
  }

  return [`${CLAUDE_AGENT_SDK_PACKAGE}-${platform}-${arch}/${binary}`];
}

function prefersMusl(): boolean {
  if (process.platform !== 'linux' || typeof process.report?.getReport !== 'function') return false;

  try {
    const report = process.report.getReport() as {header?: {glibcVersionRuntime?: string}};
    return report.header?.glibcVersionRuntime === undefined;
  } catch {
    return false;
  }
}

function executeClaudeCode(executable: string): string {
  return execFileSync(executable, ['--version'], {encoding: 'utf8', timeout: 10_000});
}

function parseClaudeCodeVersion(output: string): ClaudeCodeVersion | undefined {
  const match = CLAUDE_CODE_VERSION_PATTERN.exec(output);
  if (match === null) return undefined;

  const version = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return version.every((part) => Number.isSafeInteger(part)) ? version : undefined;
}

function formatClaudeCodeVersion(version: ClaudeCodeVersion): string {
  return version.join('.');
}

function compareClaudeCodeVersions(version: ClaudeCodeVersion, other: ClaudeCodeVersion): number {
  for (const difference of [version[0] - other[0], version[1] - other[1], version[2] - other[2]]) {
    if (difference !== 0) return difference;
  }
  return 0;
}
