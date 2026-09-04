import {Context} from '@temporalio/activity';
import {type DropExpiredUsagePartitionsResult, dropExpiredUsagePartitions} from '#db/retention.js';

export async function usageRetentionActivity(): Promise<DropExpiredUsagePartitionsResult> {
  const result = await dropExpiredUsagePartitions();
  Context.current().heartbeat({dropped: result.dropped});
  return result;
}
