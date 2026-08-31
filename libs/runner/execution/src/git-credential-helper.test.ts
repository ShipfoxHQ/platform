import {Writable} from 'node:stream';

const requestCredentialSocketMock = vi.fn();
const capability = 'job-capability';

vi.mock('@shipfox/runner-workspace/credential-socket', () => ({
  requestCredentialSocket: (...args: unknown[]) => requestCredentialSocketMock(...args),
}));

const {main, runGitCredentialHelper} = await import('#git-credential-helper.js');

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
      argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, 'get'],
      input: 'protocol=https\nhost=example.test\npath=acme/repository.git\nusername=old\n\n',
      output: output.stream,
    });

    expect(requestCredentialSocketMock).toHaveBeenCalledWith('/tmp/job.sock', {
      operation: 'get',
      repositoryUrl: 'https://example.test/acme/repository/',
      capability,
    });
    expect(output.value()).toBe('username=runner\npassword=token-a\n\n');
  });

  it.each([
    'store',
    'erase',
  ] as const)('does not send Git credentials for %s', async (operation) => {
    requestCredentialSocketMock.mockResolvedValue({version: 1, ok: true});

    await runGitCredentialHelper({
      argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, operation],
      input: `protocol=https\nhost=example.test\npath=acme/repository.git\nusername=runner\npassword=token-a\n\n`,
    });

    expect(requestCredentialSocketMock).toHaveBeenCalledWith('/tmp/job.sock', {
      operation,
      repositoryUrl: 'https://example.test/acme/repository/',
      capability,
    });
    expect(JSON.stringify(requestCredentialSocketMock.mock.calls)).not.toContain('token-a');
  });

  it('uses a complete url field and rejects unsafe repository URLs', async () => {
    requestCredentialSocketMock.mockResolvedValue({version: 1, ok: true});

    await runGitCredentialHelper({
      argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, 'get'],
      input: 'url=https://example.test/acme/repository.git\nprotocol=https\nhost=ignored.test\n\n',
    });
    expect(requestCredentialSocketMock).toHaveBeenCalledWith('/tmp/job.sock', {
      operation: 'get',
      repositoryUrl: 'https://example.test/acme/repository/',
      capability,
    });

    for (const url of [
      'http://example.test/acme/repository.git',
      'https://user:password@example.test/acme/repository.git',
      'https://example.test/acme/repository.git#fragment',
    ]) {
      await expect(
        runGitCredentialHelper({
          argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, 'get'],
          input: `url=${url}\n\n`,
        }),
      ).rejects.toThrow();
    }
    expect(requestCredentialSocketMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed for broker misses, rejected requests, and invalid arguments', async () => {
    const output = outputBuffer();
    requestCredentialSocketMock.mockResolvedValue({version: 1, ok: true});
    await runGitCredentialHelper({
      argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, 'get'],
      input: 'protocol=https\nhost=example.test\npath=acme/repository.git\n\n',
      output: output.stream,
    });
    expect(output.value()).toBe('');

    requestCredentialSocketMock.mockResolvedValue({version: 1, ok: false});
    await expect(
      runGitCredentialHelper({
        argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, 'get'],
        input: 'protocol=https\nhost=example.test\npath=acme/repository.git\n\n',
      }),
    ).rejects.toThrow('rejected');
    await expect(
      runGitCredentialHelper({
        argv: ['/helper', '--capability', capability, 'get'],
        input: 'protocol=https\nhost=example.test\npath=acme/repository.git\n\n',
      }),
    ).rejects.toThrow('socket');
    await expect(
      runGitCredentialHelper({
        argv: ['/helper', '--socket', '/tmp/job.sock', 'get'],
        input: 'protocol=https\nhost=example.test\npath=acme/repository.git\n\n',
      }),
    ).rejects.toThrow('capability');
    await expect(
      runGitCredentialHelper({
        argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, 'unknown'],
        input: 'protocol=https\nhost=example.test\npath=acme/repository.git\n\n',
      }),
    ).rejects.toThrow('Unknown');
  });

  it('reports a failed invocation without exposing input or credential values', async () => {
    const output = outputBuffer();
    let exitCode: number | undefined;
    requestCredentialSocketMock.mockRejectedValueOnce(new Error('socket unavailable'));
    await main({
      argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, 'get'],
      input: 'protocol=https\nhost=example.test\npath=acme/repository.git\n\n',
      stderr: output.stream,
      setExitCode: (code) => {
        exitCode = code;
      },
    });
    try {
      expect(exitCode).toBe(1);
      expect(output.value()).toContain('git-credential-shipfox get failed');
      expect(output.value()).not.toContain(capability);
      expect(output.value()).not.toContain('token-a');
    } finally {
      exitCode = undefined;
    }
  });

  it('fails closed for malformed input and unsafe credential output', async () => {
    await expect(
      runGitCredentialHelper({
        argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, 'get'],
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
        argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, 'get'],
        input: 'protocol=https\nhost=example.test\npath=acme/repository.git\n\n',
      }),
    ).rejects.toThrow();

    await expect(
      runGitCredentialHelper({
        argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, 'get'],
        input: 'protocol=http\nhost=example.test\npath=acme/repository.git\n\n',
      }),
    ).rejects.toThrow();
  });

  it('rejects UTF-8 credentials that exceed the byte limit', async () => {
    requestCredentialSocketMock.mockResolvedValue({
      version: 1,
      ok: true,
      credential: {username: 'runner', token: '😀'.repeat(2_049)},
    });

    await expect(
      runGitCredentialHelper({
        argv: ['/helper', '--socket', '/tmp/job.sock', '--capability', capability, 'get'],
        input: 'protocol=https\nhost=example.test\npath=acme/repository.git\n\n',
      }),
    ).rejects.toThrow();
  });
});
