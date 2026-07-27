import {closeEpisode, type EpisodeState, recordEpisode} from '#episodes.js';

describe('keyed diagnostic episodes', () => {
  it.each([
    ['opens once and suppresses repeats', 'target-a', 'failure-a'],
  ])('%s', (_name, target, fingerprint) => {
    const episodes = new Map<string, EpisodeState>();
    const first = recordEpisode(episodes, target, fingerprint, new Date(1));
    const repeat = recordEpisode(episodes, target, fingerprint, new Date(2));

    expect(first.transition).toBe('opened');
    expect(repeat.transition).toBe('suppressed');
    expect(repeat.state).toMatchObject({attempts: 2, suppressed: 1});
  });
  it('opens a changed fingerprint as a new transition', () => {
    const episodes = new Map<string, EpisodeState>();
    recordEpisode(episodes, 'target-a', 'failure-a', new Date(1));
    const changed = recordEpisode(episodes, 'target-a', 'failure-b', new Date(2));
    expect(changed.transition).toBe('changed');
    expect(changed.state).toMatchObject({fingerprint: 'failure-b', attempts: 2});
  });

  it('closes and reopens the same target as a new episode', () => {
    const episodes = new Map<string, EpisodeState>();
    recordEpisode(episodes, 'target-a', 'failure-a', new Date(1));
    closeEpisode(episodes, 'target-a');

    const reopened = recordEpisode(episodes, 'target-a', 'failure-a', new Date(3));

    expect(reopened.transition).toBe('opened');
    expect(reopened.state).toMatchObject({attempts: 1, suppressed: 0});
  });

  it('keeps cleanup failures for A and B independent', () => {
    const episodes = new Map<string, EpisodeState>();
    const a = recordEpisode(episodes, 'cleanup:A', 'remove-failed', new Date(1));
    const b = recordEpisode(episodes, 'cleanup:B', 'remove-failed', new Date(2));
    const aRepeat = recordEpisode(episodes, 'cleanup:A', 'remove-failed', new Date(3));

    expect(a.transition).toBe('opened');
    expect(b.transition).toBe('opened');
    expect(aRepeat.transition).toBe('suppressed');
    expect(episodes.size).toBe(2);
  });
  it('reminds by elapsed time instead of observation count', () => {
    const episodes = new Map<string, EpisodeState>();
    recordEpisode(episodes, 'target-a', 'failure-a', new Date(0), {
      reminderIntervalMs: 100,
    });
    const beforeInterval = recordEpisode(episodes, 'target-a', 'failure-a', new Date(99), {
      reminderIntervalMs: 100,
    });
    const atInterval = recordEpisode(episodes, 'target-a', 'failure-a', new Date(100), {
      reminderIntervalMs: 100,
    });
    expect(beforeInterval.reminder).toBe(false);
    expect(atInterval.reminder).toBe(true);
  });
  it('returns a bounded recovery summary when an episode closes', () => {
    const episodes = new Map<string, EpisodeState>();
    recordEpisode(episodes, 'target-a', 'failure-a', new Date(100));
    recordEpisode(episodes, 'target-a', 'failure-a', new Date(200));
    expect(closeEpisode(episodes, 'target-a', new Date(350))).toMatchObject({
      key: 'target-a',
      fingerprint: 'failure-a',
      durationMs: 250,
      attempts: 2,
      suppressed: 1,
    });
  });
});
