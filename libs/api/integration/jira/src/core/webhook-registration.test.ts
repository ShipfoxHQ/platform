import {JIRA_WEBHOOK_TTL_MS, registerJiraWebhook} from './webhook-registration.js';

const runInlineRegistrationLock = <T>(_lockKey: string, fn: () => Promise<T>) => fn();

describe('registerJiraWebhook', () => {
  it('persists the returned id with a 30-day expiry', async () => {
    const registerDynamicWebhook = vi.fn().mockResolvedValue({webhookId: 123});
    const deleteDynamicWebhook = vi.fn().mockResolvedValue(undefined);
    const updateInstallation = vi.fn().mockResolvedValue({id: 'installation-1'});
    const getInstallation = vi.fn().mockResolvedValue(undefined);
    const now = new Date('2030-01-01T00:00:00.000Z');

    const result = await registerJiraWebhook({
      jira: {registerDynamicWebhook, deleteDynamicWebhook},
      connectionId: 'connection-1',
      cloudId: 'cloud-1',
      accessToken: 'access-token',
      webhookUrl: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      now: () => now,
      getInstallation,
      updateInstallation,
      withRegistrationLock: (_lockKey, fn) => fn(),
    });

    expect(registerDynamicWebhook).toHaveBeenCalledWith({
      accessToken: 'access-token',
      cloudId: 'cloud-1',
      url: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
    });
    expect(getInstallation).toHaveBeenCalledWith('connection-1');
    expect(updateInstallation).toHaveBeenCalledWith({
      connectionId: 'connection-1',
      webhookIds: [123],
      webhookExpiresAt: new Date(now.getTime() + JIRA_WEBHOOK_TTL_MS),
    });
    expect(result.webhookId).toBe(123);
    expect(deleteDynamicWebhook).not.toHaveBeenCalled();
  });

  it('deletes the remote webhook when local metadata persistence fails', async () => {
    const registerDynamicWebhook = vi.fn().mockResolvedValue({webhookId: 456});
    const deleteDynamicWebhook = vi.fn().mockResolvedValue(undefined);
    const persistenceError = new Error('database unavailable');

    await expect(
      registerJiraWebhook({
        jira: {registerDynamicWebhook, deleteDynamicWebhook},
        connectionId: 'connection-1',
        cloudId: 'cloud-1',
        accessToken: 'access-token',
        webhookUrl: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
        getInstallation: vi.fn().mockResolvedValue(undefined),
        updateInstallation: vi.fn().mockRejectedValue(persistenceError),
        withRegistrationLock: runInlineRegistrationLock,
      }),
    ).rejects.toBe(persistenceError);

    expect(deleteDynamicWebhook).toHaveBeenCalledWith({
      accessToken: 'access-token',
      cloudId: 'cloud-1',
      webhookId: 456,
    });
  });

  it('does not mask the metadata error when remote cleanup fails', async () => {
    const persistenceError = new Error('database unavailable');
    const cleanupError = new Error('provider unavailable');

    await expect(
      registerJiraWebhook({
        jira: {
          registerDynamicWebhook: vi.fn().mockResolvedValue({webhookId: 789}),
          deleteDynamicWebhook: vi.fn().mockRejectedValue(cleanupError),
        },
        connectionId: 'connection-1',
        cloudId: 'cloud-1',
        accessToken: 'access-token',
        webhookUrl: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
        getInstallation: vi.fn().mockResolvedValue(undefined),
        updateInstallation: vi.fn().mockRejectedValue(persistenceError),
        withRegistrationLock: runInlineRegistrationLock,
      }),
    ).rejects.toBe(persistenceError);
  });

  it('compensates and restores metadata when activation rejects', async () => {
    const activationError = new Error('connection status update failed');
    const previousExpiry = new Date('2030-01-01T00:00:00.000Z');
    const updateInstallation = vi
      .fn()
      .mockResolvedValueOnce({id: 'installation-1'})
      .mockResolvedValueOnce({id: 'installation-1'});
    const deleteDynamicWebhook = vi.fn().mockResolvedValue(undefined);

    await expect(
      registerJiraWebhook({
        jira: {
          registerDynamicWebhook: vi.fn().mockResolvedValue({webhookId: 456}),
          deleteDynamicWebhook,
        },
        connectionId: 'connection-1',
        cloudId: 'cloud-1',
        accessToken: 'access-token',
        webhookUrl: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
        getInstallation: vi.fn().mockResolvedValue({
          webhookIds: [123],
          webhookExpiresAt: previousExpiry,
        }),
        updateInstallation,
        withRegistrationLock: runInlineRegistrationLock,
        onRegistrationSuccess: vi.fn().mockRejectedValue(activationError),
      }),
    ).rejects.toBe(activationError);

    expect(deleteDynamicWebhook).toHaveBeenCalledWith({
      accessToken: 'access-token',
      cloudId: 'cloud-1',
      webhookId: 456,
    });
    expect(updateInstallation).toHaveBeenNthCalledWith(2, {
      connectionId: 'connection-1',
      webhookIds: [123],
      webhookExpiresAt: previousExpiry,
    });
  });

  it('compensates after the lock wrapper rejects while committing a successful registration', async () => {
    const commitError = new Error('transaction commit failed');
    const previousExpiry = new Date('2030-01-01T00:00:00.000Z');
    const updateInstallation = vi
      .fn()
      .mockResolvedValueOnce({id: 'installation-1'})
      .mockResolvedValueOnce({id: 'installation-1'});
    const deleteDynamicWebhook = vi.fn().mockResolvedValue(undefined);
    const withRegistrationLock = async <T>(_lockKey: string, fn: () => Promise<T>) => {
      await fn();
      throw commitError;
    };

    await expect(
      registerJiraWebhook({
        jira: {
          registerDynamicWebhook: vi.fn().mockResolvedValue({webhookId: 789}),
          deleteDynamicWebhook,
        },
        connectionId: 'connection-1',
        cloudId: 'cloud-1',
        accessToken: 'access-token',
        webhookUrl: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
        getInstallation: vi.fn().mockResolvedValue({
          webhookIds: [123],
          webhookExpiresAt: previousExpiry,
        }),
        updateInstallation,
        withRegistrationLock,
      }),
    ).rejects.toBe(commitError);

    expect(deleteDynamicWebhook).toHaveBeenCalledWith({
      accessToken: 'access-token',
      cloudId: 'cloud-1',
      webhookId: 789,
    });
    expect(deleteDynamicWebhook).toHaveBeenCalledTimes(1);
    expect(updateInstallation).toHaveBeenNthCalledWith(2, {
      connectionId: 'connection-1',
      webhookIds: [123],
      webhookExpiresAt: previousExpiry,
    });
  });

  it('runs the error-state transition before releasing the registration lock', async () => {
    let lockCallbackCompleted = false;
    const withRegistrationLock = async <T>(_lockKey: string, fn: () => Promise<T>) => {
      try {
        return await fn();
      } finally {
        lockCallbackCompleted = true;
      }
    };
    const onRegistrationFailure = vi.fn().mockResolvedValue(undefined);

    await expect(
      registerJiraWebhook({
        jira: {
          registerDynamicWebhook: vi.fn().mockRejectedValue(new Error('provider unavailable')),
          deleteDynamicWebhook: vi.fn(),
        },
        connectionId: 'connection-1',
        cloudId: 'cloud-1',
        accessToken: 'access-token',
        webhookUrl: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
        getInstallation: vi.fn().mockResolvedValue(undefined),
        updateInstallation: vi.fn(),
        withRegistrationLock,
        onRegistrationFailure,
      }),
    ).rejects.toThrow('provider unavailable');

    expect(lockCallbackCompleted).toBe(true);
    expect(onRegistrationFailure).toHaveBeenCalledWith({});
  });

  it('persists the replacement before deleting all superseded remote webhooks', async () => {
    const calls: string[] = [];
    const updateInstallation = vi.fn().mockImplementation(() => {
      calls.push('persist');
      return Promise.resolve({id: 'installation-1'});
    });
    const deleteDynamicWebhook = vi.fn().mockImplementation(({webhookId}) => {
      calls.push(`delete:${webhookId}`);
      return Promise.resolve();
    });
    const result = await registerJiraWebhook({
      jira: {
        registerDynamicWebhook: vi.fn().mockImplementation(() => {
          calls.push('register');
          return Promise.resolve({webhookId: 456});
        }),
        deleteDynamicWebhook,
      },
      connectionId: 'connection-1',
      cloudId: 'cloud-1',
      accessToken: 'access-token',
      webhookUrl: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      getInstallation: vi.fn().mockResolvedValue({webhookIds: [123, 234]}),
      updateInstallation,
      withRegistrationLock: runInlineRegistrationLock,
    });

    expect(result.webhookId).toBe(456);
    expect(calls).toEqual(['register', 'persist', 'delete:123', 'delete:234', 'persist']);
    expect(updateInstallation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({webhookIds: [456, 123, 234]}),
    );
    expect(updateInstallation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({webhookIds: [456]}),
    );
    expect(deleteDynamicWebhook).toHaveBeenCalledTimes(2);
  });

  it('retains failed superseded webhook cleanup ids for a later retry', async () => {
    const deleteDynamicWebhook = vi
      .fn()
      .mockImplementation(({webhookId}) =>
        webhookId === 234 ? Promise.reject(new Error('provider unavailable')) : Promise.resolve(),
      );
    const updateInstallation = vi
      .fn()
      .mockResolvedValueOnce({id: 'installation-1'})
      .mockResolvedValueOnce({id: 'installation-1'});

    await expect(
      registerJiraWebhook({
        jira: {
          registerDynamicWebhook: vi.fn().mockResolvedValue({webhookId: 456}),
          deleteDynamicWebhook,
        },
        connectionId: 'connection-1',
        cloudId: 'cloud-1',
        accessToken: 'access-token',
        webhookUrl: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
        getInstallation: vi.fn().mockResolvedValue({webhookIds: [123, 234]}),
        updateInstallation,
        withRegistrationLock: runInlineRegistrationLock,
      }),
    ).resolves.toMatchObject({webhookId: 456});

    expect(updateInstallation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({webhookIds: [456, 234]}),
    );
    expect(deleteDynamicWebhook).toHaveBeenCalledTimes(2);
  });

  it('replaces stale webhook metadata when requested by renewal', async () => {
    const updateInstallation = vi
      .fn()
      .mockResolvedValueOnce({id: 'installation-1'})
      .mockResolvedValueOnce({id: 'installation-1'});
    const deleteDynamicWebhook = vi.fn().mockRejectedValue(new Error('webhook is gone'));

    await registerJiraWebhook({
      jira: {
        registerDynamicWebhook: vi.fn().mockResolvedValue({webhookId: 456}),
        deleteDynamicWebhook,
      },
      connectionId: 'connection-1',
      cloudId: 'cloud-1',
      accessToken: 'access-token',
      webhookUrl: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      getInstallation: vi.fn().mockResolvedValue({webhookIds: [123]}),
      updateInstallation,
      withRegistrationLock: runInlineRegistrationLock,
      replaceExistingWebhooks: true,
    });

    expect(updateInstallation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({webhookIds: [456]}),
    );
    expect(updateInstallation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({webhookIds: [456]}),
    );
  });

  it('keeps conservative metadata when failed cleanup cannot be persisted', async () => {
    const updateInstallation = vi
      .fn()
      .mockResolvedValueOnce({id: 'installation-1'})
      .mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      registerJiraWebhook({
        jira: {
          registerDynamicWebhook: vi.fn().mockResolvedValue({webhookId: 456}),
          deleteDynamicWebhook: vi
            .fn()
            .mockImplementation(({webhookId}) =>
              webhookId === 234
                ? Promise.reject(new Error('provider unavailable'))
                : Promise.resolve(),
            ),
        },
        connectionId: 'connection-1',
        cloudId: 'cloud-1',
        accessToken: 'access-token',
        webhookUrl: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
        getInstallation: vi.fn().mockResolvedValue({webhookIds: [123, 234]}),
        updateInstallation,
        withRegistrationLock: runInlineRegistrationLock,
      }),
    ).resolves.toMatchObject({webhookId: 456});

    expect(updateInstallation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({webhookIds: [456, 123, 234]}),
    );
  });

  it('serializes concurrent replacement and lifecycle transitions per connection', async () => {
    let releaseFirstRegistration!: (error: Error) => void;
    const firstRegistration = new Promise<never>((_, reject) => {
      releaseFirstRegistration = reject;
    });
    const registration = vi
      .fn()
      .mockReturnValueOnce(firstRegistration)
      .mockResolvedValueOnce({webhookId: 456});
    const updateInstallation = vi.fn().mockResolvedValue({id: 'installation-1'});
    const events: string[] = [];
    let lockTail = Promise.resolve();
    const withRegistrationLock = async <T>(_lockKey: string, fn: () => Promise<T>) => {
      const predecessor = lockTail;
      let release!: () => void;
      lockTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await predecessor;
      try {
        return await fn();
      } finally {
        release();
      }
    };

    const common = {
      jira: {
        registerDynamicWebhook: registration,
        deleteDynamicWebhook: vi.fn().mockResolvedValue(undefined),
      },
      connectionId: 'connection-1',
      cloudId: 'cloud-1',
      accessToken: 'access-token',
      webhookUrl: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      getInstallation: vi.fn().mockResolvedValue(undefined),
      updateInstallation,
      withRegistrationLock,
    };

    const first = registerJiraWebhook({
      ...common,
      onRegistrationFailure: () => {
        events.push('first-failure');
        return Promise.resolve();
      },
    });
    const second = registerJiraWebhook({
      ...common,
      onRegistrationSuccess: () => {
        events.push('second-success');
        return Promise.resolve();
      },
    });

    await vi.waitFor(() => expect(registration).toHaveBeenCalledOnce());
    releaseFirstRegistration(new Error('first registration failed'));

    await expect(first).rejects.toThrow('first registration failed');
    await expect(second).resolves.toMatchObject({webhookId: 456});
    expect(events).toEqual(['first-failure', 'second-success']);
    expect(updateInstallation).toHaveBeenCalledOnce();
  });
});
