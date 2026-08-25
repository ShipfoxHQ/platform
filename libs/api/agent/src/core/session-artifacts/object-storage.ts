import {reportError} from '@shipfox/node-error-monitoring';
import {
  createS3ObjectStore,
  objectStorageS3Profile,
  resolveObjectStorageS3Profile,
  type S3ObjectStore,
} from '@shipfox/node-object-storage';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {AgentSessionUnavailableError} from '../errors.js';

let _store: S3ObjectStore | undefined;

export function sessionObjectStore(): S3ObjectStore {
  if (!_store) {
    _store = createS3ObjectStore({
      profile: resolveObjectStorageS3Profile(
        objectStorageS3Profile,
        {
          endpoint: config.AGENT_SESSION_STORAGE_S3_ENDPOINT,
          region: config.AGENT_SESSION_STORAGE_S3_REGION,
          bucket: config.AGENT_SESSION_STORAGE_S3_BUCKET,
          accessKeyId: config.AGENT_SESSION_STORAGE_S3_ACCESS_KEY_ID,
          secretAccessKey: config.AGENT_SESSION_STORAGE_S3_SECRET_ACCESS_KEY,
          forcePathStyle: config.AGENT_SESSION_STORAGE_S3_FORCE_PATH_STYLE,
        },
        'AGENT_SESSION_STORAGE_S3',
      ),
      prefix: config.AGENT_SESSION_STORAGE_S3_PREFIX,
    });
  }
  return _store;
}

export function closeSessionObjectStore(): void {
  _store?.close();
  _store = undefined;
}

export interface PutSessionObjectParams {
  key: string;
  body: Buffer;
  metadata: Record<string, string>;
}

export async function putSessionObject(params: PutSessionObjectParams): Promise<void> {
  try {
    await sessionObjectStore().putBytes({
      key: params.key,
      body: params.body,
      contentType: 'application/octet-stream',
      metadata: params.metadata,
    });
  } catch (error) {
    throw toStorageUnavailable(error);
  }
}

export interface GetSessionObjectResult {
  body: Buffer;
  metadata: Record<string, string>;
}

export async function getSessionObject(key: string): Promise<GetSessionObjectResult | null> {
  try {
    const object = await sessionObjectStore().getBytes(key);
    return object ? {body: object.body, metadata: object.metadata} : null;
  } catch (error) {
    throw toStorageUnavailable(error);
  }
}

export async function listSessionObjectKeys(prefix: string): Promise<string[]> {
  try {
    return await sessionObjectStore().listKeys(prefix);
  } catch (error) {
    throw toStorageUnavailable(error);
  }
}

export async function deleteSessionObjects(keys: string[]): Promise<void> {
  try {
    await sessionObjectStore().deleteObjects(keys);
  } catch (error) {
    throw toStorageUnavailable(error);
  }
}

export async function deleteSessionObject(key: string): Promise<void> {
  try {
    await sessionObjectStore().deleteObject(key);
  } catch (error) {
    throw toStorageUnavailable(error);
  }
}

function toStorageUnavailable(error: unknown): never {
  if (error instanceof AgentSessionUnavailableError) throw error;
  logger().error({err: error}, 'Agent session artifact object store operation failed');
  reportError(error, {boundary: 'agent.session-artifacts', operation: 'object-store'});
  throw new AgentSessionUnavailableError('storage_unavailable');
}
