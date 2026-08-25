import {S3Client} from '@aws-sdk/client-s3';
import type {ObjectStorageS3Profile} from './config.js';

export interface ObjectStorageS3Clients {
  readonly control: S3Client;
  readonly transfer: S3Client;
}

export function createObjectStorageS3Clients(
  profile: ObjectStorageS3Profile,
): ObjectStorageS3Clients {
  const connection = {
    endpoint: profile.endpoint,
    region: profile.region,
    forcePathStyle: profile.forcePathStyle,
    ...(profile.credentials ? {credentials: profile.credentials} : {}),
  };

  return {
    control: new S3Client({
      ...connection,
      maxAttempts: 2,
      requestHandler: {connectionTimeout: 1_000, requestTimeout: 3_000},
    }),
    transfer: new S3Client({
      ...connection,
      maxAttempts: 3,
      requestHandler: {connectionTimeout: 5_000, requestTimeout: 0},
    }),
  };
}
