import {DeleteObjectsCommand, ListObjectsV2Command, S3Client} from '@aws-sdk/client-s3';
import type {ObjectStorageS3Profile} from './config.js';
import {ObjectStorageDeleteError, ObjectStorageScopeError} from './errors.js';
import {createS3ObjectStore} from './store.js';

const profile: ObjectStorageS3Profile = {
  endpoint: 'https://objects.example.test',
  region: 'test-region',
  bucket: 'test-bucket',
  credentials: {accessKeyId: 'access', secretAccessKey: 'secret'},
  forcePathStyle: true,
};

describe('S3ObjectStore scope', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    '',
    '/logs',
    'logs/',
    'logs//archive',
    'logs/../agent-sessions',
  ])('rejects the invalid prefix %j', (prefix) => {
    expect(() => createS3ObjectStore({profile, prefix})).toThrow(
      'Object-storage prefix must be non-empty without leading, trailing, repeated, or parent-directory segments.',
    );
  });

  it('rejects an invalid transfer timeout before constructing clients', () => {
    expect(() =>
      createS3ObjectStore({profile, prefix: 'logs', transferRequestTimeoutMs: Number.NaN}),
    ).toThrow('Object-storage transfer request timeout must be a non-negative integer.');
  });

  it('rejects keys outside the consumer prefix before sending a command', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send');
    const store = createS3ObjectStore({profile, prefix: 'logs'});

    const result = store.deleteObject('agent-sessions/session-1');

    await expect(result).rejects.toBeInstanceOf(ObjectStorageScopeError);
    expect(send).not.toHaveBeenCalled();
    store.close();
  });

  it('paginates listings inside the configured prefix', async () => {
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValueOnce({
        Contents: [{Key: 'logs/a'}],
        IsTruncated: true,
        NextContinuationToken: 'next',
      } as never)
      .mockResolvedValueOnce({Contents: [{Key: 'logs/b'}], IsTruncated: false} as never);
    const store = createS3ObjectStore({profile, prefix: 'logs'});

    const keys = await store.listKeys('logs/workspace');

    expect(keys).toEqual(['logs/a', 'logs/b']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(ListObjectsV2Command);
    store.close();
  });

  it('chunks deletes at the S3 limit', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const store = createS3ObjectStore({profile, prefix: 'logs'});
    const keys = Array.from({length: 1001}, (_, index) => `logs/${index}`);

    await store.deleteObjects(keys);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectsCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(DeleteObjectsCommand);
    store.close();
  });

  it('reports partial delete failures', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      Errors: [{Key: 'logs/failed', Code: 'AccessDenied', Message: 'denied'}],
    } as never);
    const store = createS3ObjectStore({profile, prefix: 'logs'});

    const error = await store.deleteObjects(['logs/failed']).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ObjectStorageDeleteError);
    if (!(error instanceof ObjectStorageDeleteError)) throw error;
    expect(error.failures).toEqual([{key: 'logs/failed', code: 'AccessDenied', message: 'denied'}]);
    store.close();
  });
});
