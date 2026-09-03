import {mkdtemp, rm} from 'node:fs/promises';
import {connect} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  type CredentialSocketTransportHandler,
  type CredentialSocketTransportResponseInput,
  createCredentialSocketTransportServer,
  MAX_CREDENTIAL_SOCKET_REQUEST_BYTES,
  requestCredentialSocketTransport,
} from '#credential-socket-transport.js';

const capability = 'transport-capability';

function exchange(
  socketPath: string,
  body: string,
  end = true,
): Promise<{body: string; connected: boolean}> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const chunks: Buffer[] = [];
    let connected = false;
    let settled = false;
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('error', (error) => {
      if (!connected && !settled) {
        settled = true;
        reject(error);
      }
    });
    socket.once('close', () => {
      if (settled) return;
      settled = true;
      resolve({body: Buffer.concat(chunks).toString('utf8'), connected});
    });
    socket.once('connect', () => {
      connected = true;
      if (end) socket.end(body);
      else if (body.length > 0) socket.write(body);
    });
  });
}

describe('credential socket transport framing', () => {
  let root: string;
  let socketPath: string;
  let handleRequest: ReturnType<typeof vi.fn<CredentialSocketTransportHandler>>;
  let server: ReturnType<typeof createCredentialSocketTransportServer>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 's-'));
    socketPath = join(root, 'c.sock');
    handleRequest = vi.fn<CredentialSocketTransportHandler>((request) => ({
      ok: true,
      echo: request.payload,
    }));
    server = createCredentialSocketTransportServer({
      socketPath,
      capability,
      timeoutMs: 25,
      handleRequest,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.close();
    await rm(root, {recursive: true, force: true});
  });

  it('frames generic payloads and lets handlers omit the protocol version', async () => {
    await expect(
      requestCredentialSocketTransport(socketPath, {
        capability,
        payload: {kind: 'credential'},
      }),
    ).resolves.toEqual({
      version: 1,
      ok: true,
      echo: {kind: 'credential'},
    });
    expect(handleRequest).toHaveBeenCalledWith(
      expect.objectContaining({version: 1, capability, payload: {kind: 'credential'}}),
      expect.any(AbortSignal),
    );
  });

  it('returns a bounded rejection for a capability mismatch without invoking the handler', async () => {
    await expect(
      requestCredentialSocketTransport(socketPath, {capability: 'wrong-capability'}),
    ).resolves.toEqual({version: 1, ok: false});
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it('returns a bounded rejection for malformed framing', async () => {
    const result = await exchange(socketPath, '{"version":1,"capability":"transport-capability"}');
    expect(JSON.parse(result.body)).toEqual({version: 1, ok: false});
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it('closes an oversized request before invoking the handler', async () => {
    const result = await exchange(socketPath, 'x'.repeat(MAX_CREDENTIAL_SOCKET_REQUEST_BYTES + 1));
    expect(result.connected).toBe(true);
    expect(result.body).toBe('');
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it('closes an incomplete request after the configured timeout', async () => {
    const result = await exchange(
      socketPath,
      JSON.stringify({version: 1, capability}).slice(0, -1),
      false,
    );
    expect(result.connected).toBe(true);
    expect(result.body).toBe('');
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it('aborts an in-flight handler and waits for it during shutdown', async () => {
    let requestSignal!: AbortSignal;
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    handleRequest.mockImplementation((_request, signal) => {
      requestSignal = signal;
      resolveStarted();
      return new Promise<CredentialSocketTransportResponseInput>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('handler aborted')), {
          once: true,
        });
      });
    });
    const client = connect(socketPath);
    client.once('error', () => undefined);
    client.once('connect', () =>
      client.end(`${JSON.stringify({version: 1, capability, payload: 'pending'})}\n`),
    );

    await started;
    await expect(server.close()).resolves.toBeUndefined();
    expect(requestSignal.aborted).toBe(true);
    client.destroy();
  });
});
