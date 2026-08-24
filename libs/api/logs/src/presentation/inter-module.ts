import {logsInterModuleContract} from '@shipfox/api-logs-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {appendServerRecords} from '#core/append-server-records.js';
import {LeaseStreamMismatchError, MalformedLogChunkError, OffsetGapError} from '#core/errors.js';

/**
 * Producer presentation for the Logs inter-module contract: server-origin log
 * appends for server-executed steps. No consumer exists yet — the tool step
 * executor (ENG-1680) calls `appendServerRecords` through the generated
 * `LogsModuleClient`.
 */
export function createLogsInterModulePresentation(): InterModulePresentation<
  typeof logsInterModuleContract
> {
  return defineInterModulePresentation(logsInterModuleContract, {
    appendServerRecords: async (input) => {
      try {
        return await appendServerRecords(input);
      } catch (error) {
        throw toAppendServerRecordsKnownError(error);
      }
    },
  });
}

export function toAppendServerRecordsKnownError(error: unknown): unknown {
  const method = logsInterModuleContract.methods.appendServerRecords;
  if (error instanceof LeaseStreamMismatchError) {
    return createInterModuleKnownError(method, 'lease-stream-mismatch', {});
  }
  if (error instanceof MalformedLogChunkError) {
    return createInterModuleKnownError(method, 'malformed-log-chunk', {});
  }
  if (error instanceof OffsetGapError) {
    return createInterModuleKnownError(method, 'offset-gap', {
      committedLength: error.committedLength,
    });
  }
  return error;
}
