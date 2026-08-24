import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {AgentSessionUnavailableError} from '../errors.js';

const explicitS3Credentials =
  config.AGENT_SESSION_STORAGE_S3_ACCESS_KEY_ID && config.AGENT_SESSION_STORAGE_S3_SECRET_ACCESS_KEY
    ? {
        accessKeyId: config.AGENT_SESSION_STORAGE_S3_ACCESS_KEY_ID,
        secretAccessKey: config.AGENT_SESSION_STORAGE_S3_SECRET_ACCESS_KEY,
      }
    : undefined;

let _client: S3Client | undefined;

/** Lazily-built S3 client targeting the configured object store (Garage in dev). */
export function sessionS3Client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: config.AGENT_SESSION_STORAGE_S3_ENDPOINT,
      region: config.AGENT_SESSION_STORAGE_S3_REGION,
      forcePathStyle: config.AGENT_SESSION_STORAGE_S3_FORCE_PATH_STYLE,
      ...(explicitS3Credentials ? {credentials: explicitS3Credentials} : {}),
      // Fail fast: a slow or black-holed endpoint must not hang callers behind
      // SDK backoff. One retry, short connect/request timeouts.
      maxAttempts: 2,
      requestHandler: {connectionTimeout: 1_000, requestTimeout: 3_000},
    });
  }
  return _client;
}

export function closeSessionS3Client(): void {
  _client?.destroy();
  _client = undefined;
}

export interface PutSessionObjectParams {
  key: string;
  body: Buffer;
  /** Segment manifest fields; returned as metadata headers by the GET path. */
  metadata: Record<string, string>;
}

/** Puts one immutable transcript object. S3 `PutObject` overwrites by design; retries re-upload the same key with an equivalent plaintext, which the byte-exact read path cannot distinguish. */
export async function putSessionObject(params: PutSessionObjectParams): Promise<void> {
  try {
    await sessionS3Client().send(
      new PutObjectCommand({
        Bucket: config.AGENT_SESSION_STORAGE_S3_BUCKET,
        Key: params.key,
        Body: params.body,
        ContentType: 'application/octet-stream',
        Metadata: params.metadata,
      }),
    );
  } catch (error) {
    throw toStorageUnavailable(error);
  }
}

export interface GetSessionObjectResult {
  body: Buffer;
  metadata: Record<string, string>;
}

/** Reads one transcript object; returns null when the key does not exist. */
export async function getSessionObject(key: string): Promise<GetSessionObjectResult | null> {
  try {
    const response = await sessionS3Client().send(
      new GetObjectCommand({Bucket: config.AGENT_SESSION_STORAGE_S3_BUCKET, Key: key}),
    );
    const body = response.Body
      ? Buffer.from(await response.Body.transformToByteArray())
      : Buffer.alloc(0);
    return {body, metadata: response.Metadata ?? {}};
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw toStorageUnavailable(error);
  }
}

/** Lists object keys under a per-session prefix (retention and pruning). */
export async function listSessionObjectKeys(prefix: string): Promise<string[]> {
  if (prefix === '') {
    throw new Error(
      'listSessionObjectKeys refuses an empty prefix (it would list the whole bucket)',
    );
  }
  try {
    const client = sessionS3Client();
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: config.AGENT_SESSION_STORAGE_S3_BUCKET,
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
  } catch (error) {
    throw toStorageUnavailable(error);
  }
}

/** Deletes a batch of object keys; S3 delete is idempotent (missing keys are a success). */
export async function deleteSessionObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    const client = sessionS3Client();
    // S3 caps one DeleteObjects request at 1000 keys; a session's segment count
    // is bounded by reported attempts, so one batch normally suffices.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000).map((Key) => ({Key}));
      const deleted = await client.send(
        new DeleteObjectsCommand({
          Bucket: config.AGENT_SESSION_STORAGE_S3_BUCKET,
          Delete: {Objects: batch, Quiet: true},
        }),
      );
      if (deleted.Errors && deleted.Errors.length > 0) {
        const [first] = deleted.Errors;
        throw new Error(
          `Failed to delete ${deleted.Errors.length} session object(s): ${first?.Key} ${first?.Message}`,
        );
      }
    }
  } catch (error) {
    throw toStorageUnavailable(error);
  }
}

/** Deletes one object key (used for the exact head key of a carried-over row). */
export async function deleteSessionObject(key: string): Promise<void> {
  try {
    await sessionS3Client().send(
      new DeleteObjectCommand({Bucket: config.AGENT_SESSION_STORAGE_S3_BUCKET, Key: key}),
    );
  } catch (error) {
    throw toStorageUnavailable(error);
  }
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as {name?: unknown}).name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

function toStorageUnavailable(error: unknown): never {
  if (error instanceof AgentSessionUnavailableError) throw error;
  logger().error({err: error}, 'Agent session artifact object store operation failed');
  reportError(error, {boundary: 'agent.session-artifacts', operation: 'object-store'});
  throw new AgentSessionUnavailableError('storage_unavailable');
}
