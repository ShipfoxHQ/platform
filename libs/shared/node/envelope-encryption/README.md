# Shipfox envelope encryption

Shared Node infrastructure for AES-GCM envelopes, wrapped data keys, bounded plaintext-key caching, and KEK rotation.

## What it does

- **Envelope codecs**: Seals text values and versioned binary blobs with AES-256-GCM and caller-supplied AAD.
- **`createLocalKeyProvider`**: Wraps data-encryption keys under current and previous local key-encryption keys.
- **`DataKeyManager`**: Loads or creates wrapped data keys and caches decrypted copies with LRU and TTL bounds.
- **`rotateDataKeys`**: Wraps stored data keys again with pagination, stranded-version checks, and compare-and-swap writes.

## Installation and setup

```sh
pnpm add @shipfox/node-envelope-encryption
```

Callers provide key material, persistence adapters, AAD, and a stable key-version domain. The package does not read environment variables or own database tables.

## Usage

```ts
import crypto from 'node:crypto';
import {
  createLocalKeyProvider,
  decodeBase64Key,
  openEnvelopeText,
  sealEnvelopeText,
} from '@shipfox/node-envelope-encryption';

const key = decodeBase64Key(crypto.randomBytes(32).toString('base64'), 'EXAMPLE_KEK');
const provider = createLocalKeyProvider({
  currentKek: key,
  keyVersionDomain: 'example-data-key-version',
});
const aad = JSON.stringify(['workspace-1', 'TOKEN']);
const sealed = sealEnvelopeText({key, plaintext: Buffer.from('value'), aad});

openEnvelopeText({key, encoded: sealed, aad});
provider.wrapDek('workspace-1', crypto.randomBytes(32));
```

## Behavior notes

Text envelopes use the `v1:` base64 format. Binary envelopes include a fixed magic prefix and format version before the encrypted bytes.

AAD and key-version domains are security boundaries. Callers must use stable, domain-specific values and keep unrelated data classes on separate key-encryption keys.

The local provider accepts one previous KEK during rotation. Run `rotateDataKeys` before removing that key or old data keys become unreadable.

The cache attempts to wipe Buffer contents during eviction. Node may retain copied or moved memory.

## Development

```sh
turbo check --filter=@shipfox/node-envelope-encryption
turbo type --filter=@shipfox/node-envelope-encryption
turbo test --filter=@shipfox/node-envelope-encryption
turbo build --filter=@shipfox/node-envelope-encryption
```

## License

MIT
