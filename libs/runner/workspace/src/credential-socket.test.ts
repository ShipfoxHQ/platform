import {mkdtemp, rm, stat} from 'node:fs/promises';
import {connect} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CredentialBroker, type CredentialRenewal} from '#credential-broker.js';
import {createCredentialSocketServer, requestCredentialSocket} from '#credential-socket.js';

const repositoryUrl = 'https://example.test/acme/repository.git';
const capability = 'job-capability';

function requestRawCredentialSocket(socketPath: string, body: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let response = '';
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8');
    });
    socket.once('error', reject);
    socket.once('end', () => {
      try {
        resolve(JSON.parse(response));
      } catch (error) {
        reject(error);
      }
    });
    socket.once('connect', () => socket.end(body));
  });
}

describe('credential socket transport', () => {
  let root: string;
  let socketPath: string;
  let broker: CredentialBroker;
  const renew = vi.fn<CredentialRenewal>();
  let server: ReturnType<typeof createCredentialSocketServer>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-credential-socket-'));
    socketPath = join(root, 'credential.sock');
    renew.mockReset().mockResolvedValue({
      username: 'runner',
      token: 'token-b',
      generation: 'generation-b',
      expiresAt: 20_000,
      renewal: {mode: 'on-rejection' as const},
    });
    broker = new CredentialBroker({
      renew,
      now: () => 1_000,
    });
    broker.register({
      repositoryUrl,
      subject: 'job-1',
      credential: {
        username: 'runner',
        token: 'token-a',
        generation: 'generation-a',
        expiresAt: 10_000,
        renewal: {mode: 'on-rejection'},
      },
    });
    server = createCredentialSocketServer({socketPath, capability, broker});
    await server.start();
  });

  afterEach(async () => {
    await server.close();
    broker.shutdown();
    await rm(root, {recursive: true, force: true});
  });

  it('serves get, treats store as a no-op, and renews after erase', async () => {
    await expect(
      requestCredentialSocket(socketPath, {operation: 'get', repositoryUrl, capability}),
    ).resolves.toEqual({
      version: 1,
      ok: true,
      credential: {username: 'runner', token: 'token-a'},
    });

    await expect(
      requestCredentialSocket(socketPath, {operation: 'store', repositoryUrl, capability}),
    ).resolves.toEqual({version: 1, ok: true});
    await expect(
      requestCredentialSocket(socketPath, {operation: 'get', repositoryUrl, capability}),
    ).resolves.toMatchObject({credential: {token: 'token-a'}});

    await expect(
      requestCredentialSocket(socketPath, {operation: 'erase', repositoryUrl, capability}),
    ).resolves.toEqual({version: 1, ok: true});
    await expect(
      requestCredentialSocket(socketPath, {operation: 'get', repositoryUrl, capability}),
    ).resolves.toMatchObject({credential: {token: 'token-b'}});
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid client setup and unsafe server repository URLs', async () => {
    await expect(
      requestCredentialSocket('relative.sock', {operation: 'get', repositoryUrl, capability}),
    ).rejects.toThrow('path');

    for (const unsafeRepositoryUrl of [
      'http://example.test/acme/repository.git',
      'https://user:password@example.test/acme/repository.git',
      'https://example.test/acme/repository.git?token=secret',
      'https://example.test/acme/repository.git#fragment',
    ]) {
      await expect(
        requestCredentialSocket(socketPath, {
          operation: 'get',
          repositoryUrl: unsafeRepositoryUrl,
          capability,
        }),
      ).resolves.toEqual({version: 1, ok: false});
    }

    await expect(requestRawCredentialSocket(socketPath, 'not-json\n')).resolves.toEqual({
      version: 1,
      ok: false,
    });
  });

  it('cancels in-flight broker work when the server closes', async () => {
    let startRenewal!: () => void;
    let releaseRenewal!: () => void;
    const renewalStarted = new Promise<void>((resolve) => (startRenewal = resolve));
    const pendingRenewal = new Promise<{
      username: string;
      token: string;
      generation: string;
      expiresAt: number;
      renewal: {mode: 'on-rejection'};
    }>((resolve) => {
      releaseRenewal = () =>
        resolve({
          username: 'runner',
          token: 'token-after-close',
          generation: 'generation-after-close',
          expiresAt: 20_000,
          renewal: {mode: 'on-rejection'},
        });
    });
    renew.mockImplementation(() => {
      startRenewal();
      return pendingRenewal;
    });
    const client = connect(socketPath);
    client.once('connect', () =>
      client.end(
        `${JSON.stringify({version: 1, operation: 'erase', repositoryUrl, capability})}\n`,
      ),
    );

    await renewalStarted;
    await expect(server.close()).resolves.toBeUndefined();
    client.destroy();
    releaseRenewal();
  });

  it('uses a private socket and does not serve a credential for an unregistered repository URL', async () => {
    expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
    const unregistered = await requestCredentialSocket(socketPath, {
      operation: 'get',
      repositoryUrl: 'https://example.test/acme/other-repository.git',
      capability,
    });
    expect(unregistered).toEqual({version: 1, ok: true});

    await expect(
      requestCredentialSocket(socketPath, {
        operation: 'get',
        repositoryUrl,
        capability: 'wrong-capability',
      }),
    ).resolves.toEqual({version: 1, ok: false});
    expect(renew).not.toHaveBeenCalled();
  });
});
