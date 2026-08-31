import {mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CredentialBroker, type CredentialRenewal} from '#credential-broker.js';
import {createCredentialSocketServer, requestCredentialSocket} from '#credential-socket.js';

const repositoryUrl = 'https://example.test/acme/repository.git';
const capability = 'job-capability';

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
