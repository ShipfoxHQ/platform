import {GithubInstallStateError} from './errors.js';
import {signGithubInstallState, verifyGithubInstallState} from './state.js';

describe('GitHub install state', () => {
  it('verifies a signed state payload', () => {
    const state = signGithubInstallState({
      workspaceId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      nonce: 'nonce',
      now: new Date('2026-04-30T00:00:00.000Z'),
    });

    const result = verifyGithubInstallState(state, new Date('2026-04-30T00:01:00.000Z'));

    expect(result.workspaceId).toBeTypeOf('string');
    expect(result.userId).toBeTypeOf('string');
  });

  it('rejects expired state payloads', () => {
    const state = signGithubInstallState({
      workspaceId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      nonce: 'nonce',
      now: new Date('2026-04-30T00:00:00.000Z'),
    });

    const result = () => verifyGithubInstallState(state, new Date('2026-04-30T00:11:00.000Z'));

    expect(result).toThrow(GithubInstallStateError);
  });

  it('rejects tampered state payloads', () => {
    const state = signGithubInstallState({
      workspaceId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      nonce: 'nonce',
    });

    const result = () => verifyGithubInstallState(`${state}tampered`);

    expect(result).toThrow(GithubInstallStateError);
  });
});
