export interface EpisodeState {
  readonly fingerprint: string;
  readonly startedAt: Date;
  readonly attempts: number;
  readonly suppressed: number;
  readonly lastReminderAt?: Date | undefined;
}

export type EpisodeTransition = 'opened' | 'changed' | 'suppressed';

export interface EpisodeUpdate {
  readonly transition: EpisodeTransition;
  readonly state: EpisodeState;
  readonly reminder: boolean;
}

export interface EpisodeRecovery {
  readonly key: string;
  readonly fingerprint: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly durationMs: number;
  readonly attempts: number;
  readonly suppressed: number;
}

const REMINDER_INTERVAL_MS = 60_000;

/**
 * Record one observation of a keyed diagnostic episode. The map is the only mutable
 * ownership point; callers decide whether an opened/changed/reminder update is logged.
 */
export function recordEpisode(
  episodes: Map<string, EpisodeState>,
  key: string,
  fingerprint: string,
  at: Date,
  options?: {readonly reminderIntervalMs?: number},
): EpisodeUpdate {
  const reminderIntervalMs = options?.reminderIntervalMs ?? REMINDER_INTERVAL_MS;
  const previous = episodes.get(key);
  if (!previous) {
    const state = {fingerprint, startedAt: at, attempts: 1, suppressed: 0};
    episodes.set(key, state);
    return {transition: 'opened', state, reminder: false};
  }
  if (previous.fingerprint !== fingerprint) {
    const state = {
      ...previous,
      fingerprint,
      attempts: previous.attempts + 1,
      lastReminderAt: at,
    };
    episodes.set(key, state);
    return {transition: 'changed', state, reminder: false};
  }
  const reminder =
    at.getTime() - (previous.lastReminderAt?.getTime() ?? previous.startedAt.getTime()) >=
    reminderIntervalMs;
  const state = {
    ...previous,
    attempts: previous.attempts + 1,
    suppressed: previous.suppressed + 1,
    ...(reminder ? {lastReminderAt: at} : {}),
  };
  episodes.set(key, state);
  return {transition: 'suppressed', state, reminder};
}

export function closeEpisode(
  episodes: Map<string, EpisodeState>,
  key: string,
  endedAt = new Date(),
): EpisodeRecovery | undefined {
  const state = episodes.get(key);
  if (!state) return undefined;
  episodes.delete(key);
  return {
    key,
    fingerprint: state.fingerprint,
    startedAt: state.startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt.getTime() - state.startedAt.getTime()),
    attempts: state.attempts,
    suppressed: state.suppressed,
  };
}
