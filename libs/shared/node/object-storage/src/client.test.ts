import {createObjectStorageS3Clients} from './client.js';
import type {ObjectStorageS3Profile} from './config.js';

interface RequestHandlerConfig {
  connectionTimeout?: number | undefined;
  requestTimeout?: number | undefined;
  throwOnRequestTimeout?: boolean | undefined;
}

function requestHandlerConfig(
  client: ReturnType<typeof createObjectStorageS3Clients>['control'],
): Promise<RequestHandlerConfig> {
  return (
    client.config.requestHandler as unknown as {configProvider: Promise<RequestHandlerConfig>}
  ).configProvider;
}

const profile: ObjectStorageS3Profile = {
  endpoint: 'https://objects.example.test',
  region: 'test-region',
  bucket: 'test-bucket',
  credentials: {accessKeyId: 'explicit-access', secretAccessKey: 'explicit-secret'},
  forcePathStyle: true,
};

describe('createObjectStorageS3Clients', () => {
  it('uses the explicit credentials for control and transfer clients', async () => {
    const clients = createObjectStorageS3Clients(profile);

    const credentials = await Promise.all([
      clients.control.config.credentials(),
      clients.transfer.config.credentials(),
    ]);

    expect(credentials).toEqual([
      expect.objectContaining({accessKeyId: 'explicit-access', secretAccessKey: 'explicit-secret'}),
      expect.objectContaining({accessKeyId: 'explicit-access', secretAccessKey: 'explicit-secret'}),
    ]);
    clients.control.destroy();
    clients.transfer.destroy();
  });

  it('enforces the control timeout and a configured transfer timeout', async () => {
    const clients = createObjectStorageS3Clients(profile, {transferRequestTimeoutMs: 300_000});

    await expect(requestHandlerConfig(clients.control)).resolves.toMatchObject({
      connectionTimeout: 1_000,
      requestTimeout: 3_000,
      throwOnRequestTimeout: true,
    });
    await expect(requestHandlerConfig(clients.transfer)).resolves.toMatchObject({
      connectionTimeout: 5_000,
      requestTimeout: 300_000,
      throwOnRequestTimeout: true,
    });
    clients.control.destroy();
    clients.transfer.destroy();
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects the invalid transfer timeout %s', (transferRequestTimeoutMs) => {
    expect(() => createObjectStorageS3Clients(profile, {transferRequestTimeoutMs})).toThrow(
      'Object-storage transfer request timeout must be a non-negative integer.',
    );
  });
});
