import {Context} from '@temporalio/activity';
import {type DropExpiredUsagePartitionsResult, dropExpiredUsagePartitions} from '#db/retention.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

export async function usageRetentionActivity(): Promise<DropExpiredUsagePartitionsResult> {
  const activityContext = Context.current();
  const heartbeat = (details: {dropped?: number; stage?: string}) => {
    try {
      activityContext.heartbeat(details);
    } catch {
      // A heartbeat failure must not turn a completed database operation into a retry.
    }
  };
  const heartbeatTimer = setInterval(() => heartbeat({stage: 'retention'}), HEARTBEAT_INTERVAL_MS);

  try {
    const result = await dropExpiredUsagePartitions();
    heartbeat({dropped: result.dropped});
    return result;
  } finally {
    clearInterval(heartbeatTimer);
  }
}
