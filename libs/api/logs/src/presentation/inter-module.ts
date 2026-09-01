import {logsInterModuleContract} from '@shipfox/api-logs-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {appendServerRecords} from '#core/append-server-records.js';
import {
  CompactedLogUnavailableError,
  LeaseStreamMismatchError,
  LogAppendBodyTooLargeError,
  LogWriterConflictError,
  MalformedLogChunkError,
  OffsetGapError,
} from '#core/errors.js';
import {readStepLogTail} from '#core/read-step-log-tail.js';

/**
 * Producer presentation for exact-attempt log reads and server-origin log appends. The tool step
 * executor (ENG-1680) calls the append method through the generated `LogsModuleClient`; the
 * agent-access gateway consumes the bounded read method.
 */
export function createLogsInterModulePresentation(): InterModulePresentation<
  typeof logsInterModuleContract
> {
  return defineInterModulePresentation(logsInterModuleContract, {
    readStepLogTail: async (input) => {
      try {
        return await readStepLogTail(input);
      } catch (error) {
        throw toReadStepLogTailKnownError(error);
      }
    },
    appendServerRecords: async (input) => {
      try {
        return await appendServerRecords(input);
      } catch (error) {
        throw toAppendServerRecordsKnownError(error);
      }
    },
  });
}

export function toReadStepLogTailKnownError(error: unknown): unknown {
  const method = logsInterModuleContract.methods.readStepLogTail;
  if (error instanceof CompactedLogUnavailableError) {
    return createInterModuleKnownError(method, 'compacted-log-unavailable', {});
  }
  return error;
}

export function toAppendServerRecordsKnownError(error: unknown): unknown {
  const method = logsInterModuleContract.methods.appendServerRecords;
  if (error instanceof LeaseStreamMismatchError) {
    return createInterModuleKnownError(method, 'lease-stream-mismatch', {});
  }
  if (error instanceof MalformedLogChunkError) {
    return createInterModuleKnownError(method, 'malformed-log-chunk', {});
  }
  if (error instanceof LogAppendBodyTooLargeError) {
    return createInterModuleKnownError(method, 'append-body-too-large', {
      maxBytes: error.maxBytes,
    });
  }
  if (error instanceof LogWriterConflictError && error.activeOrigin === 'runner') {
    return createInterModuleKnownError(method, 'runner-writer-active', {});
  }
  if (error instanceof OffsetGapError) {
    return createInterModuleKnownError(method, 'offset-gap', {
      committedLength: error.committedLength,
    });
  }
  return error;
}
