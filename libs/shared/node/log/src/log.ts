import {createRequire} from 'node:module';

import type {Level, LogFn, LoggerOptions, TransportTargetOptions} from 'pino';
import {config, resolveDestinationLevel} from './config.js';

export type {Level, LogFn} from 'pino';

type PinoModule = typeof import('pino');

const require = createRequire(import.meta.url);
let pinoModule: PinoModule | undefined;

function getPino(): PinoModule {
  if (!pinoModule) pinoModule = require('pino') as PinoModule;
  return pinoModule;
}

const stdoutLevel = resolveDestinationLevel(
  config.LOG_STDOUT_LEVEL,
  config.LOG_LEVEL,
  'LOG_STDOUT_LEVEL',
);
const fileLevel = resolveDestinationLevel(
  config.LOG_FILE_LEVEL,
  config.LOG_LEVEL,
  'LOG_FILE_LEVEL',
);

const transports: TransportTargetOptions[] = [];
if (config.LOG_STDOUT) {
  if (config.LOG_PRETTY) {
    transports.push({target: 'pino-pretty', level: stdoutLevel, options: {colorize: true}});
  } else {
    transports.push({target: 'pino/file', level: stdoutLevel, options: {destination: 1}});
  }
}
if (config.LOG_FILE) {
  transports.push({
    target: 'pino/file',
    level: fileLevel,
    options: {destination: config.LOG_FILE, mkdir: true},
  });
}

function createTransportStream() {
  const pino = getPino();
  return pino.multistream(
    transports.map(({level, options, target}) => {
      const stream =
        options === undefined ? pino.transport({target}) : pino.transport({options, target});
      return {level: level ?? config.LOG_LEVEL, stream};
    }),
  );
}

export const settings: LoggerOptions = {
  level: config.LOG_LEVEL,
  transport: {targets: transports},
  get timestamp() {
    return getPino().stdTimeFunctions.isoTime;
  },
  get serializers() {
    const {stdSerializers} = getPino();
    return {
      error: stdSerializers.errWithCause,
      errors: (errors: unknown) => {
        if (Array.isArray(errors))
          return errors.map((error) => stdSerializers.errWithCause(error as Error));
        return stdSerializers.errWithCause(errors as Error);
      },
      err: stdSerializers.errWithCause,
      req: stdSerializers.req,
      res: stdSerializers.res,
    };
  },
};

type PinoLogger = Pick<ReturnType<PinoModule>, Level | 'flush'>;
let logger: PinoLogger | undefined;

function getLogger(): PinoLogger {
  if (!logger) logger = createLogger({});
  return logger;
}

export function createLogger(options: LoggerOptions) {
  const pino = getPino();
  if (options.transport) return pino({...settings, ...options});

  const {transport: _transport, ...loggerOptions} = {...settings, ...options};
  return pino(loggerOptions, createTransportStream());
}

export type Logger = {
  [level in Level]: LogFn;
} & {
  flush: (cb?: (error?: Error) => void) => void;
};

function getLogMethod(level: Level): LogFn {
  return (...args: unknown[]) => {
    const currentLogger = getLogger();
    Reflect.apply(currentLogger[level], currentLogger, args);
  };
}

export const log: Logger = {
  trace: getLogMethod('trace'),
  debug: getLogMethod('debug'),
  info: getLogMethod('info'),
  warn: getLogMethod('warn'),
  error: getLogMethod('error'),
  fatal: getLogMethod('fatal'),
  flush: (cb) => getLogger().flush(cb),
};
