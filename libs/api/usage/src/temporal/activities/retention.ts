import {CancelledFailure, Context} from '@temporalio/activity';
import {type DropExpiredUsagePartitionsResult, dropExpiredUsagePartitions} from '#db/retention.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

export async function usageRetentionActivity(): Promise<DropExpiredUsagePartitionsResult> {
  const activityContext = Context.current();
  let cancellationFailure: CancelledFailure | undefined;
  const heartbeat = (details: {dropped?: number; stage?: string}) => {
    try {
      activityContext.heartbeat(details);
    } catch (error) {
      if (error instanceof CancelledFailure) {
        cancellationFailure = error;
      }
    }
  };
  const heartbeatTimer = setInterval(() => heartbeat({stage: 'retention'}), HEARTBEAT_INTERVAL_MS);

  try {
    const result = await dropExpiredUsagePartitions();
    heartbeat({dropped: result.dropped});
    if (cancellationFailure) throw cancellationFailure;
    return result;
  } finally {
    clearInterval(heartbeatTimer);
  }
}
