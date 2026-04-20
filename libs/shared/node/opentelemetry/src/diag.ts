import {DiagConsoleLogger, diag} from '@opentelemetry/api';
import {config} from '#config.js';

const logLevels: Record<string, number> = {
  none: 0,
  /** Identifies an error scenario */
  error: 30,
  /** Identifies a warning scenario */
  warn: 50,
  /** General informational log message */
  info: 60,
  /** General debug log message */
  debug: 70,
  /**
   * Detailed trace level logging should only be used for development, should only be set
   * in a development environment.
   */
  verbose: 80,
  /** Used to set the logging level to include all logging */
  all: 9999,
};

const logLevel = logLevels[config.OTEL_DIAG_LOG_LEVEL];

if (logLevel) diag.setLogger(new DiagConsoleLogger(), logLevel);
