import {logsInterModuleContract} from '@shipfox/api-logs-dto/inter-module';
import {defineInterModulePresentation, type InterModulePresentation} from '@shipfox/inter-module';
import {appendServerRecords} from '#core/append-server-records.js';

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
    appendServerRecords: async (input) => appendServerRecords(input),
  });
}
