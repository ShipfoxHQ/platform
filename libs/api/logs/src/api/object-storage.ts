import type {Readable} from 'node:stream';
import {reportError} from '@shipfox/node-error-monitoring';
import {
  createS3ObjectStore,
  objectStorageS3Profile,
  resolveObjectStorageS3Profile,
  type S3ObjectStore,
  type StoredObjectHead,
  type StoredObjectStream,
} from '@shipfox/node-object-storage';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {type LogObjectKeyParams, logObjectKey} from '#core/entities/log-object.js';

let _store: S3ObjectStore | undefined;

export function objectStore(): S3ObjectStore {
  if (!_store) {
    _store = createS3ObjectStore({
      profile: resolveObjectStorageS3Profile(
        objectStorageS3Profile,
        {
          endpoint: config.LOG_STORAGE_S3_ENDPOINT,
          region: config.LOG_STORAGE_S3_REGION,
          bucket: config.LOG_STORAGE_S3_BUCKET,
          accessKeyId: config.LOG_STORAGE_S3_ACCESS_KEY_ID,
          secretAccessKey: config.LOG_STORAGE_S3_SECRET_ACCESS_KEY,
          forcePathStyle: config.LOG_STORAGE_S3_FORCE_PATH_STYLE,
        },
        'LOG_STORAGE_S3',
      ),
      prefix: config.LOG_STORAGE_S3_PREFIX,
    });
  }
  return _store;
}

export function closeS3Client(): void {
  _store?.close();
  _store = undefined;
}

export function checkBucketReachable(): Promise<boolean> {
  return objectStore().checkReachable();
}

export function compactedObjectKey(identity: LogObjectKeyParams, uploadToken: string): string {
  return `${logObjectKey(config.LOG_STORAGE_S3_PREFIX, identity)}/${uploadToken}`;
}

/** The bounded cold tail is a sibling object of the full compacted stream. */
export function compactedTailObjectKey(fullObjectKey: string): string {
  return `${fullObjectKey}.tail`;
}

const UPLOAD_PART_SIZE = 5 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 2;

export interface PutCompactedObjectParams {
  key: string;
  body: Readable;
  metadata: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: () => void;
}

export async function putCompactedObject(params: PutCompactedObjectParams): Promise<void> {
  await objectStore().putMultipart({
    key: params.key,
    body: params.body,
    partSize: UPLOAD_PART_SIZE,
    concurrency: UPLOAD_CONCURRENCY,
    contentType: 'application/x-ndjson',
    contentEncoding: 'gzip',
    metadata: params.metadata,
    signal: params.signal,
    onProgress: params.onProgress,
    onAbortError: (error) => {
      logger().error({err: error, objectKey: params.key}, 'Failed to abort multipart log upload');
      reportError(error, {
        boundary: 'logs.cleanup',
        operation: 'abort-multipart-upload',
        extra: {objectKey: params.key},
      });
    },
  });
}

export async function deleteObject(key: string): Promise<void> {
  await objectStore().deleteObject(key);
}

export function presignedGetUrl(objectKey: string): Promise<{url: string; expiresAt: Date}> {
  return objectStore().presignGet(objectKey, config.LOG_READ_URL_TTL_SECONDS);
}

export async function deleteObjectsByPrefix(prefix: string): Promise<void> {
  await objectStore().deleteByPrefix(prefix);
}

export async function getObjectBytes(key: string): Promise<Buffer | null> {
  return (await objectStore().getBytes(key))?.body ?? null;
}

export function getObjectStream(key: string): Promise<StoredObjectStream | null> {
  return objectStore().getStream(key);
}

export function headObject(key: string): Promise<StoredObjectHead | null> {
  return objectStore().head(key);
}

export function listObjectKeys(prefix: string): Promise<string[]> {
  return objectStore().listKeys(prefix);
}

export async function putObjectBytes(key: string, body: Buffer): Promise<void> {
  await objectStore().putBytes({key, body});
}
