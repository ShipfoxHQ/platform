import type {PollDemandResponseDto} from '@shipfox/api-runners-dto';
import type {PollDemandResult} from '#core/demand.js';

export function toPollDemandResponseDto(result: PollDemandResult): PollDemandResponseDto {
  return {
    stats: result.stats.map((stat) => ({
      ...(stat.workspaceId ? {workspace_id: stat.workspaceId} : {}),
      labels: stat.labels,
      queued: stat.queued,
      reserved: stat.reserved,
      oldest_queued_at: stat.oldestQueuedAt.toISOString(),
    })),
    reservations: result.reservations.map((reservation) => ({
      reservation_id: reservation.reservationId,
      ...(reservation.workspaceId ? {workspace_id: reservation.workspaceId} : {}),
      labels: reservation.labels,
      count: reservation.count,
      expires_at: reservation.expiresAt.toISOString(),
    })),
    ...(result.newlyReservedCount !== undefined
      ? {newly_reserved_count: result.newlyReservedCount}
      : {}),
    terminate_provider_runner_ids: result.terminateRunnerInstanceIds,
  };
}
