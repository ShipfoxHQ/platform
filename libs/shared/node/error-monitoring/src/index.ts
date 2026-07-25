export {
  addEventProcessor,
  captureException,
  close as closeErrorMonitoring,
  flush as flushErrorMonitoring,
} from '@sentry/node';
export {
  type ErrorReportContext,
  isErrorReported,
  markErrorReported,
  reportError,
} from './report-error.js';
