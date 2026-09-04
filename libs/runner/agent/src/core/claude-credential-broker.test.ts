import {mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {main, runClaudeAuthHelper} from '#core/claude-auth-helper.js';
import {
  CLAUDE_CREDENTIAL_HELPER_TTL_MS,
  claudeCredentialHelperEnvironment,
  createClaudeCredentialBroker,
} from '#core/claude-credential-broker.js';
import type {InferenceCredential, InferenceCredentialSource} from '#core/harness.js';

function outputBuffer(): {output: {write(chunk: string): void}; read: () => string} {
  let value = '';
  return {
    output: {
      write(chunk: string) {
        value += chunk;
      },
    },
    read: () => value,
  };
}

async function withBroker<T>(
  source: InferenceCredentialSource,
  operation: (broker: ReturnType<typeof createClaudeCredentialBroker>) => Promise<T>,
  options: {monotonicNow?: () => number} = {},
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-claude-credential-'));
  const broker = createClaudeCredentialBroker({
    credentialSource: source,
    signal: new AbortController().signal,
    socketDirectory: root,
    ...options,
  });
  try {
    await broker.start();
    return await operation(broker);
  } finally {
    await broker.close();
    await rm(root, {recursive: true, force: true});
  }
}

function helperCall(broker: ReturnType<typeof createClaudeCredentialBroker>): Promise<string> {
  const buffer = outputBuffer();
  return runClaudeAuthHelper({
    env: claudeCredentialHelperEnvironment(broker),
    output: buffer.output,
  }).then(() => buffer.read());
}

describe('Claude renewable credential broker and helper', () => {
  it('writes only the current credential to helper stdout', async () => {
    const source: InferenceCredentialSource = {
      resolve: vi.fn().mockResolvedValue({token: 'jwt-1', generation: 'generation-1'}),
      close: vi.fn(),
    };

    await withBroker(source, async (broker) => {
      await expect(helperCall(broker)).resolves.toBe('jwt-1\n');
      expect(source.resolve).toHaveBeenCalledWith();
    });
  });

  it('uses rejection renewal before the helper deadline and scheduled renewal at the deadline', async () => {
    let now = 100;
    const credentials: InferenceCredential[] = [
      {token: 'jwt-1', generation: 'generation-1'},
      {token: 'jwt-2', generation: 'generation-2'},
      {token: 'jwt-3', generation: 'generation-3'},
    ];
    let index = 0;
    const resolve = vi.fn<InferenceCredentialSource['resolve']>((_options) => {
      const credential = credentials[index++] ?? {token: 'jwt-fallback', generation: 'fallback'};
      return Promise.resolve(credential);
    });
    const source: InferenceCredentialSource = {resolve, close: vi.fn()};

    await withBroker(
      source,
      async (broker) => {
        await expect(helperCall(broker)).resolves.toBe('jwt-1\n');

        now += CLAUDE_CREDENTIAL_HELPER_TTL_MS - 1;
        await expect(helperCall(broker)).resolves.toBe('jwt-2\n');

        now += CLAUDE_CREDENTIAL_HELPER_TTL_MS;
        await expect(helperCall(broker)).resolves.toBe('jwt-3\n');
      },
      {monotonicNow: () => now},
    );

    expect(resolve).toHaveBeenNthCalledWith(1);
    expect(resolve).toHaveBeenNthCalledWith(2, {rejectedGeneration: 'generation-1'});
    expect(resolve).toHaveBeenNthCalledWith(3);
  });

  it('shares concurrent early rejection renewals', async () => {
    let now = 100;
    let releaseRenewal!: (credential: InferenceCredential) => void;
    let renewalStarted = false;
    const resolve = vi.fn<InferenceCredentialSource['resolve']>((options) => {
      if (options?.rejectedGeneration === 'generation-1' && !renewalStarted) {
        renewalStarted = true;
        return new Promise((resolveRenewal) => {
          releaseRenewal = resolveRenewal;
        });
      }
      return Promise.resolve({token: 'jwt-1', generation: 'generation-1'});
    });
    const source: InferenceCredentialSource = {resolve, close: vi.fn()};

    await withBroker(
      source,
      async (broker) => {
        await helperCall(broker);
        now += 1;
        const first = helperCall(broker);
        const second = helperCall(broker);
        await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
        releaseRenewal({token: 'jwt-2', generation: 'generation-2'});
        await expect(Promise.all([first, second])).resolves.toEqual(['jwt-2\n', 'jwt-2\n']);
      },
      {monotonicNow: () => now},
    );

    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('reports helper failures without returning credential material', async () => {
    const source: InferenceCredentialSource = {
      resolve: vi.fn().mockRejectedValue(new Error('renewal failed jwt-secret')),
      close: vi.fn(),
    };

    await withBroker(source, async (broker) => {
      const stderr = outputBuffer();
      let exitCode: number | undefined;
      await main({
        env: claudeCredentialHelperEnvironment(broker),
        stderr: stderr.output,
        setExitCode: (code) => {
          exitCode = code;
        },
      });
      expect(exitCode).toBe(1);
      expect(stderr.read()).toBe('claude-auth-helper failed: Error\n');
      expect(stderr.read()).not.toContain('jwt-secret');
    });
  });

  it('removes the per-step socket on close', async () => {
    const source: InferenceCredentialSource = {
      resolve: vi.fn().mockResolvedValue({token: 'jwt-1', generation: 'generation-1'}),
      close: vi.fn(),
    };
    const root = await mkdtemp(join(tmpdir(), 'shipfox-claude-credential-'));
    const broker = createClaudeCredentialBroker({
      credentialSource: source,
      signal: new AbortController().signal,
      socketDirectory: root,
    });

    try {
      await broker.start();
      await expect(stat(broker.socketPath)).resolves.toBeDefined();
      await broker.close();
      await expect(stat(broker.socketPath)).rejects.toMatchObject({code: 'ENOENT'});
    } finally {
      await broker.close();
      await rm(root, {recursive: true, force: true});
    }
  });

  it('removes the per-step socket when the step aborts', async () => {
    const source: InferenceCredentialSource = {
      resolve: vi.fn().mockResolvedValue({token: 'jwt-1', generation: 'generation-1'}),
      close: vi.fn(),
    };
    const root = await mkdtemp(join(tmpdir(), 'shipfox-claude-credential-'));
    const controller = new AbortController();
    const broker = createClaudeCredentialBroker({
      credentialSource: source,
      signal: controller.signal,
      socketDirectory: root,
    });

    try {
      await broker.start();
      await expect(stat(broker.socketPath)).resolves.toBeDefined();
      controller.abort();
      await vi.waitFor(() =>
        expect(stat(broker.socketPath)).rejects.toMatchObject({code: 'ENOENT'}),
      );
    } finally {
      await broker.close();
      await rm(root, {recursive: true, force: true});
    }
  });
});
