# Shipfox object storage

Shared Node infrastructure for scoped S3-compatible object storage.

## What it does

- **Shared S3 profile**: Loads one endpoint, region, bucket, credential pair, and addressing mode.
- **`S3ObjectStore`**: Restricts object operations to one non-empty key prefix.
- **Object operations**: Uploads and reads bytes, streams multipart uploads, signs reads, lists keys, and deletes objects.
- **Client policies**: Uses short timeouts for control operations and long-lived clients for data transfer.

## Installation and setup

```sh
pnpm add @shipfox/node-object-storage
```

Set the `OBJECT_STORAGE_S3_*` variables for the deployment. Leave both credential variables unset to use the AWS SDK credential provider chain.

## Usage

```ts
import {
  createS3ObjectStore,
  objectStorageS3Profile,
} from '@shipfox/node-object-storage';

const sessions = createS3ObjectStore({
  profile: objectStorageS3Profile,
  prefix: 'agent-sessions',
});

await sessions.putBytes({
  key: 'agent-sessions/workspace/run/session/1',
  body: Buffer.from('encrypted transcript'),
  contentType: 'application/octet-stream',
});

sessions.close();
```

## Environment

The schema in `src/config.ts` owns the shared S3 variables and their defaults. Consumers can resolve package-specific overrides with `resolveObjectStorageS3Profile`.

## Behavior notes

Every store requires a non-empty prefix. List and delete operations reject keys outside that prefix.

The package does not own object-key layouts, encryption, retention decisions, retries, telemetry, CORS, or bucket lifecycle policies.

## Development

```sh
turbo check --filter=@shipfox/node-object-storage
turbo type --filter=@shipfox/node-object-storage
turbo test --filter=@shipfox/node-object-storage
turbo build --filter=@shipfox/node-object-storage
```

## License

MIT
