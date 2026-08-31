import {Writable} from 'node:stream';

const requestCredentialSocketMock = vi.fn();

vi.mock('@shipfox/runner-workspace/credential-socket', () => ({
  requestCredentialSocket: (...args: unknown[]) => requestCredentialSocketMock(...args),
}));

const {runGitCredentialHelper} = await import('#git-credential-helper.js');

function outputBuffer(): {stream: Writable; value: () => string} {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return {stream, value: () => Buffer.concat(chunks).toString('utf8')};
}

describe('Git credential helper', () => {
  beforeEach(() => requestCredentialSocketMock.mockReset());

  it('returns only the broker credential for get', async () => {
    requestCredentialSocketMock.mockResolvedValue({
      version: 1,
      ok: true,
      credential: {username: 'runner', token: 'token-a'},
    });
    const output = outputBuffer();

    await runGitCredentialHelper({
      argv: ['/helper', '--socket', '/tmp/job.sock', 'get'],
      input: 'protocol=https\nhost=example.test\npath=acme/repository.git\nusername=old\n\n',
      output: output.stream,
    });

    expect(requestCredentialSocketMock).toHaveBeenCalledWith('/tmp/job.sock', {
      operation: 'get',
      repositoryUrl: 'https://example.test/acme/repository.git',
    });
    expect(output.value()).toBe('username=runner\npassword=token-a\n\n');
  });

  it.each([
    'store',
    'erase',
  ] as const)('does not send Git credentials for %s', async (operation) => {
    requestCredentialSocketMock.mockResolvedValue({version: 1, ok: true});

    await runGitCredentialHelper({
      argv: ['/helper', '--socket', '/tmp/job.sock', operation],
      input: `protocol=https\nhost=example.test\npath=acme/repository.git\nusername=runner\npassword=token-a\n\n`,
    });

    expect(requestCredentialSocketMock).toHaveBeenCalledWith('/tmp/job.sock', {
      operation,
      repositoryUrl: 'https://example.test/acme/repository.git',
    });
    expect(JSON.stringify(requestCredentialSocketMock.mock.calls)).not.toContain('token-a');
  });

  it('fails closed for malformed input and unsafe credential output', async () => {
    await expect(
      runGitCredentialHelper({
        argv: ['/helper', '--socket', '/tmp/job.sock', 'get'],
        input: 'protocol=https\nhost=example.test\npath=acme/repository.git?token=secret\n\n',
      }),
    ).rejects.toThrow();
    expect(requestCredentialSocketMock).not.toHaveBeenCalled();

    requestCredentialSocketMock.mockResolvedValue({
      version: 1,
      ok: true,
      credential: {username: 'runner', token: 'token\n-a'},
    });
    await expect(
      runGitCredentialHelper({
        argv: ['/helper', '--socket', '/tmp/job.sock', 'get'],
        input: 'protocol=https\nhost=example.test\npath=acme/repository.git\n\n',
      }),
    ).rejects.toThrow();
  });
});
