import {loadObjectStorageS3Profile, resolveObjectStorageS3Profile} from './config.js';

describe('loadObjectStorageS3Profile', () => {
  it('leaves the shared bucket unset for consumer-owned bucket selection', () => {
    const profile = loadObjectStorageS3Profile({OBJECT_STORAGE_S3_BUCKET: undefined});

    expect(profile.bucket).toBeUndefined();
  });

  it('loads one explicit credential pair', () => {
    const profile = loadObjectStorageS3Profile({
      OBJECT_STORAGE_S3_ACCESS_KEY_ID: 'access-key',
      OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: 'secret-key',
    });

    expect(profile.credentials).toEqual({accessKeyId: 'access-key', secretAccessKey: 'secret-key'});
  });

  it.each([
    ['access-key', undefined],
    [undefined, 'secret-key'],
  ])('rejects a partial credential pair', (accessKeyId, secretAccessKey) => {
    expect(() =>
      loadObjectStorageS3Profile({
        OBJECT_STORAGE_S3_ACCESS_KEY_ID: accessKeyId,
        OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: secretAccessKey,
      }),
    ).toThrow(
      'OBJECT_STORAGE_S3_ACCESS_KEY_ID and OBJECT_STORAGE_S3_SECRET_ACCESS_KEY must be set together',
    );
  });
});

describe('resolveObjectStorageS3Profile', () => {
  const base = loadObjectStorageS3Profile({
    OBJECT_STORAGE_S3_ENDPOINT: 'https://objects.example.test',
    OBJECT_STORAGE_S3_REGION: 'base-region',
    OBJECT_STORAGE_S3_BUCKET: 'base-bucket',
    OBJECT_STORAGE_S3_ACCESS_KEY_ID: 'base-access',
    OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: 'base-secret',
    OBJECT_STORAGE_S3_FORCE_PATH_STYLE: 'false',
  });

  it('uses consumer fields over the shared profile', () => {
    const resolved = resolveObjectStorageS3Profile(
      base,
      {bucket: 'sessions', forcePathStyle: true},
      'AGENT_SESSION_STORAGE_S3',
    );

    expect(resolved).toEqual({...base, bucket: 'sessions', forcePathStyle: true});
  });

  it('uses a consumer bucket when the shared bucket is unset', () => {
    const withoutBucket = loadObjectStorageS3Profile({
      OBJECT_STORAGE_S3_ENDPOINT: 'https://objects.example.test',
      OBJECT_STORAGE_S3_REGION: 'base-region',
      OBJECT_STORAGE_S3_BUCKET: undefined,
      OBJECT_STORAGE_S3_FORCE_PATH_STYLE: 'false',
    });

    const resolved = resolveObjectStorageS3Profile(
      withoutBucket,
      {bucket: 'consumer-bucket'},
      'LOG_STORAGE_S3',
    );

    expect(resolved.bucket).toBe('consumer-bucket');
  });

  it('rejects a consumer without a shared or consumer bucket', () => {
    const withoutBucket = loadObjectStorageS3Profile({OBJECT_STORAGE_S3_BUCKET: undefined});

    expect(() => resolveObjectStorageS3Profile(withoutBucket, {}, 'LOG_STORAGE_S3')).toThrow(
      'LOG_STORAGE_S3_BUCKET or OBJECT_STORAGE_S3_BUCKET must be set.',
    );
  });

  it('treats consumer credentials as one pair', () => {
    expect(() =>
      resolveObjectStorageS3Profile(
        base,
        {accessKeyId: 'override-access'},
        'AGENT_SESSION_STORAGE_S3',
      ),
    ).toThrow(
      'AGENT_SESSION_STORAGE_S3_ACCESS_KEY_ID and AGENT_SESSION_STORAGE_S3_SECRET_ACCESS_KEY must be set together',
    );
  });

  it('keeps shared credentials when consumer credential overrides are empty', () => {
    const resolved = resolveObjectStorageS3Profile(
      base,
      {accessKeyId: '', secretAccessKey: ''},
      'AGENT_SESSION_STORAGE_S3',
    );

    expect(resolved.credentials).toEqual(base.credentials);
  });

  it('rejects a non-empty consumer credential paired with an empty override', () => {
    expect(() =>
      resolveObjectStorageS3Profile(
        base,
        {accessKeyId: 'override-access', secretAccessKey: ''},
        'AGENT_SESSION_STORAGE_S3',
      ),
    ).toThrow(
      'AGENT_SESSION_STORAGE_S3_ACCESS_KEY_ID and AGENT_SESSION_STORAGE_S3_SECRET_ACCESS_KEY must be set together',
    );
  });
});
