import {
  RUNNER_ASSIGNMENT_POLL_DEFAULT_WAIT_SECONDS,
  runnerAssignmentPollQuerySchema,
} from './runner-enrollment.js';

describe('runnerAssignmentPollQuerySchema', () => {
  it('coerces a bounded wait from the HTTP query string', () => {
    expect(runnerAssignmentPollQuerySchema.parse({wait_seconds: '12'})).toEqual({
      wait_seconds: 12,
    });
  });

  it('rejects a zero-second assignment wait', () => {
    expect(runnerAssignmentPollQuerySchema.safeParse({wait_seconds: '0'}).success).toBe(false);
  });

  it.each(['-1', '1.5', 'not-a-number'])('rejects invalid wait_seconds %s', (waitSeconds) => {
    expect(runnerAssignmentPollQuerySchema.safeParse({wait_seconds: waitSeconds}).success).toBe(
      false,
    );
  });
});

it('keeps the protocol default explicit', () => {
  expect(RUNNER_ASSIGNMENT_POLL_DEFAULT_WAIT_SECONDS).toBe(30);
});
