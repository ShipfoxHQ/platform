export type {
  ObjectStorageS3Credentials,
  ObjectStorageS3Profile,
  ObjectStorageS3ProfileOverrides,
} from './config.js';
export {
  loadObjectStorageS3Profile,
  objectStorageConfigSchema,
  objectStorageS3Profile,
  resolveObjectStorageS3Profile,
} from './config.js';
export {
  ObjectStorageDeleteError,
  type ObjectStorageDeleteFailure,
  ObjectStorageScopeError,
  ObjectStorageUploadAbortedError,
} from './errors.js';
export type {
  CreateS3ObjectStoreOptions,
  PresignedObjectGet,
  PutMultipartObjectParams,
  PutObjectBytesParams,
  StoredObjectBytes,
  StoredObjectHead,
} from './store.js';
export {assertObjectStoragePrefix, createS3ObjectStore, S3ObjectStore} from './store.js';
