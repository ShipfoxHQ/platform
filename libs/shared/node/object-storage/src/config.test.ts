import {loadObjectStorageS3Profile, resolveObjectStorageS3Profile} from './config.js';

describe('loadObjectStorageS3Profile', () => {
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
});
