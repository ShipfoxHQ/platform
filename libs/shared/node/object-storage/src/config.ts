import {bool, createConfig, str, url} from '@shipfox/config';

export interface ObjectStorageS3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface ObjectStorageS3Profile {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly credentials?: ObjectStorageS3Credentials | undefined;
  readonly forcePathStyle: boolean;
}

export interface ObjectStorageS3BaseProfile {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket?: string | undefined;
  readonly credentials?: ObjectStorageS3Credentials | undefined;
  readonly forcePathStyle: boolean;
}

export interface ObjectStorageS3ProfileOverrides {
  readonly endpoint?: string | undefined;
  readonly region?: string | undefined;
  readonly bucket?: string | undefined;
  readonly accessKeyId?: string | undefined;
  readonly secretAccessKey?: string | undefined;
  readonly forcePathStyle?: boolean | undefined;
}

export const objectStorageConfigSchema = {
  OBJECT_STORAGE_S3_ENDPOINT: url({
    desc: 'Endpoint URL of the shared S3-compatible object store. Defaults to the bundled local-development Garage at http://localhost:3900. Set the production object-store endpoint for a self-hosted deployment.',
    default: 'http://localhost:3900',
  }),
  OBJECT_STORAGE_S3_REGION: str({
    desc: 'Region passed to the shared S3 client. Any value works for Garage. Set the real region for AWS S3. Defaults to garage for local development.',
    default: 'garage',
  }),
  OBJECT_STORAGE_S3_BUCKET: str({
    desc: 'Optional default bucket used by Shipfox object-storage consumers. Leave it unset when every consumer selects its own bucket. Local development sets it to the shipfox bucket that dev/garage/bootstrap.sh creates.',
    default: undefined,
  }),
  OBJECT_STORAGE_S3_ACCESS_KEY_ID: str({
    desc: 'Optional access key ID used to authenticate to the shared object store. Set it with OBJECT_STORAGE_S3_SECRET_ACCESS_KEY, or leave both unset to use the standard AWS SDK credential provider chain.',
    default: undefined,
  }),
  OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: str({
    desc: 'Optional secret access key used to authenticate to the shared object store. Set it with OBJECT_STORAGE_S3_ACCESS_KEY_ID, or leave both unset to use the standard AWS SDK credential provider chain.',
    default: undefined,
  }),
  OBJECT_STORAGE_S3_FORCE_PATH_STYLE: bool({
    desc: 'Whether the shared object store addresses buckets as endpoint/bucket instead of bucket.endpoint. Set true for Garage and MinIO. Set false for AWS S3.',
    default: true,
  }),
};

export function loadObjectStorageS3Profile(
  update?: Partial<NodeJS.ProcessEnv>,
): ObjectStorageS3BaseProfile {
  const loaded = createConfig(objectStorageConfigSchema, update);
  const credentials = credentialPair(
    loaded.OBJECT_STORAGE_S3_ACCESS_KEY_ID,
    loaded.OBJECT_STORAGE_S3_SECRET_ACCESS_KEY,
    'OBJECT_STORAGE_S3',
  );

  return {
    endpoint: loaded.OBJECT_STORAGE_S3_ENDPOINT,
    region: loaded.OBJECT_STORAGE_S3_REGION,
    bucket: loaded.OBJECT_STORAGE_S3_BUCKET,
    credentials,
    forcePathStyle: loaded.OBJECT_STORAGE_S3_FORCE_PATH_STYLE,
  };
}

export function resolveObjectStorageS3Profile(
  base: ObjectStorageS3BaseProfile,
  overrides: ObjectStorageS3ProfileOverrides,
  overrideName: string,
): ObjectStorageS3Profile {
  const accessKeyId = emptyStringAsUndefined(overrides.accessKeyId);
  const secretAccessKey = emptyStringAsUndefined(overrides.secretAccessKey);
  const hasCredentialOverride = accessKeyId !== undefined || secretAccessKey !== undefined;
  const credentials = hasCredentialOverride
    ? credentialPair(accessKeyId, secretAccessKey, overrideName)
    : base.credentials;
  const bucket = emptyStringAsUndefined(overrides.bucket) ?? base.bucket;
  if (!bucket) {
    throw new Error(`${overrideName}_BUCKET or OBJECT_STORAGE_S3_BUCKET must be set.`);
  }

  return {
    endpoint: overrides.endpoint ?? base.endpoint,
    region: overrides.region ?? base.region,
    bucket,
    credentials,
    forcePathStyle: overrides.forcePathStyle ?? base.forcePathStyle,
  };
}

function emptyStringAsUndefined(value: string | undefined): string | undefined {
  return value === '' ? undefined : value;
}

function credentialPair(
  accessKeyId: string | undefined,
  secretAccessKey: string | undefined,
  name: string,
): ObjectStorageS3Credentials | undefined {
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error(
      `${name}_ACCESS_KEY_ID and ${name}_SECRET_ACCESS_KEY must be set together or both left unset.`,
    );
  }
  return accessKeyId && secretAccessKey ? {accessKeyId, secretAccessKey} : undefined;
}

export const objectStorageS3Profile = loadObjectStorageS3Profile();
