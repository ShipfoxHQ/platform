import {bool, createConfig, str} from '@shipfox/config';

export const logLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
export type LogLevel = (typeof logLevels)[number];

const levelRanks: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
  silent: 6,
};

export const config = createConfig({
  LOG_LEVEL: str({
    desc: 'Lowest log level that gets written. Accepts fatal, error, warn, info, debug, trace, or silent.',
    choices: logLevels,
    default: 'info',
  }),
  LOG_STDOUT_LEVEL: str({
    desc: 'Lowest log level written to standard output. Defaults to LOG_LEVEL and cannot be more verbose than LOG_LEVEL.',
    choices: logLevels,
    default: undefined,
  }),
  LOG_FILE_LEVEL: str({
    desc: 'Lowest log level written to LOG_FILE. Defaults to LOG_LEVEL and cannot be more verbose than LOG_LEVEL.',
    choices: logLevels,
    default: undefined,
  }),
  LOG_PRETTY: bool({
    desc: 'Formats logs for human reading instead of JSON. Use it in local development.',
    default: false,
  }),
  LOG_STDOUT: bool({
    desc: 'Writes logs to standard output. Turn it off to log only to a file.',
    default: true,
  }),
  LOG_FILE: str({
    desc: 'Path to a file that also receives logs. Parent folders are created if needed. Leave it unset to disable file logging.',
    default: undefined,
  }),
});

export function resolveDestinationLevel(
  destination: LogLevel | undefined,
  global: LogLevel,
  destinationName: string,
): LogLevel {
  const resolved = destination ?? global;
  if (levelRanks[resolved] < levelRanks[global]) {
    throw new Error(`${destinationName} cannot be more verbose than LOG_LEVEL`);
  }
  return resolved;
}
