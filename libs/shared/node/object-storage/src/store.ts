import type {Readable} from 'node:stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {Upload} from '@aws-sdk/lib-storage';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {createObjectStorageS3Clients, type ObjectStorageS3Clients} from './client.js';
import type {ObjectStorageS3Profile} from './config.js';
import {
  ObjectStorageDeleteError,
  ObjectStorageScopeError,
  ObjectStorageUploadAbortedError,
} from './errors.js';

export interface CreateS3ObjectStoreOptions {
  readonly profile: ObjectStorageS3Profile;
  readonly prefix: string;
}

export interface PutObjectBytesParams {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType?: string | undefined;
  readonly contentEncoding?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
}

export interface PutMultipartObjectParams {
  readonly key: string;
  readonly body: Readable;
  readonly contentType?: string | undefined;
  readonly contentEncoding?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
  readonly partSize: number;
  readonly concurrency: number;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: (() => void) | undefined;
  readonly onAbortError?: ((error: unknown) => void) | undefined;
}

export interface StoredObjectBytes {
  readonly body: Buffer;
  readonly metadata: Record<string, string>;
  readonly contentType?: string | undefined;
  readonly contentEncoding?: string | undefined;
}

export interface StoredObjectHead {
  readonly metadata: Record<string, string>;
  readonly contentType?: string | undefined;
  readonly contentEncoding?: string | undefined;
  readonly contentLength?: number | undefined;
}

export interface PresignedObjectGet {
  readonly url: string;
  readonly expiresAt: Date;
}

export class S3ObjectStore {
  readonly #bucket: string;
  readonly #prefix: string;
  readonly #clients: ObjectStorageS3Clients;

  constructor({profile, prefix}: CreateS3ObjectStoreOptions) {
    if (prefix === '' || prefix.startsWith('/') || prefix.endsWith('/')) {
      throw new Error(
        'Object-storage prefix must be non-empty without a leading or trailing slash.',
      );
    }
    this.#bucket = profile.bucket;
    this.#prefix = prefix;
    this.#clients = createObjectStorageS3Clients(profile);
  }

  async checkReachable(): Promise<boolean> {
    try {
      await this.#clients.control.send(new HeadBucketCommand({Bucket: this.#bucket}));
      return true;
    } catch {
      return false;
    }
  }

  async putBytes(params: PutObjectBytesParams): Promise<void> {
    this.#assertInScope(params.key);
    await this.#clients.transfer.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        ContentEncoding: params.contentEncoding,
        Metadata: params.metadata,
      }),
    );
  }

  async putMultipart(params: PutMultipartObjectParams): Promise<void> {
    this.#assertInScope(params.key);
    const upload = new Upload({
      client: this.#clients.transfer,
      partSize: params.partSize,
      queueSize: params.concurrency,
      params: {
        Bucket: this.#bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        ContentEncoding: params.contentEncoding,
        Metadata: params.metadata,
      },
    });

    if (params.onProgress) upload.on('httpUploadProgress', params.onProgress);
    const abortUpload = () =>
      upload.abort().catch((error: unknown) => {
        params.onAbortError?.(error);
      });
    const handleAbort = () => {
      void abortUpload();
    };
    if (params.signal) params.signal.addEventListener('abort', handleAbort, {once: true});

    try {
      if (params.signal?.aborted) {
        await abortUpload();
        throw new ObjectStorageUploadAbortedError();
      }
      await upload.done();
    } finally {
      params.signal?.removeEventListener('abort', handleAbort);
    }
  }

  async getBytes(key: string): Promise<StoredObjectBytes | null> {
    this.#assertInScope(key);
    try {
      const response = await this.#clients.transfer.send(
        new GetObjectCommand({Bucket: this.#bucket, Key: key}),
      );
      const body = response.Body
        ? Buffer.from(await response.Body.transformToByteArray())
        : Buffer.alloc(0);
      return {
        body,
        metadata: response.Metadata ?? {},
        contentType: response.ContentType,
        contentEncoding: response.ContentEncoding,
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async head(key: string): Promise<StoredObjectHead | null> {
    this.#assertInScope(key);
    try {
      const response = await this.#clients.control.send(
        new HeadObjectCommand({Bucket: this.#bucket, Key: key}),
      );
      return {
        metadata: response.Metadata ?? {},
        contentType: response.ContentType,
        contentEncoding: response.ContentEncoding,
        contentLength: response.ContentLength,
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    this.#assertInScope(prefix);
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const listed = await this.#clients.control.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of listed.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  async deleteObject(key: string): Promise<void> {
    this.#assertInScope(key);
    await this.#clients.control.send(new DeleteObjectCommand({Bucket: this.#bucket, Key: key}));
  }

  async deleteObjects(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.#assertInScope(key);
    for (let index = 0; index < keys.length; index += 1000) {
      const batch = keys.slice(index, index + 1000).map((Key) => ({Key}));
      if (batch.length === 0) continue;
      const deleted = await this.#clients.control.send(
        new DeleteObjectsCommand({
          Bucket: this.#bucket,
          Delete: {Objects: batch, Quiet: true},
        }),
      );
      if (deleted.Errors && deleted.Errors.length > 0) {
        throw new ObjectStorageDeleteError(
          deleted.Errors.map((failure) => ({
            key: failure.Key,
            code: failure.Code,
            message: failure.Message,
          })),
        );
      }
    }
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    this.#assertInScope(prefix);
    let continuationToken: string | undefined;
    do {
      const listed = await this.#clients.control.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      await this.deleteObjects(
        (listed.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])),
      );
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  async presignGet(key: string, expiresInSeconds: number): Promise<PresignedObjectGet> {
    this.#assertInScope(key);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const url = await getSignedUrl(
      this.#clients.control,
      new GetObjectCommand({Bucket: this.#bucket, Key: key}),
      {expiresIn: expiresInSeconds},
    );
    return {url, expiresAt};
  }

  close(): void {
    this.#clients.control.destroy();
    this.#clients.transfer.destroy();
  }

  #assertInScope(key: string): void {
    if (key !== this.#prefix && !key.startsWith(`${this.#prefix}/`)) {
      throw new ObjectStorageScopeError(key, this.#prefix);
    }
  }
}

export function createS3ObjectStore(options: CreateS3ObjectStoreOptions): S3ObjectStore {
  return new S3ObjectStore(options);
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as {name?: unknown}).name;
  return name === 'NoSuchKey' || name === 'NotFound';
}
