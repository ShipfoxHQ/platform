# Shipfox Tokens

Opaque token helpers for Shipfox services. It creates prefixed random tokens, hashes raw token values for storage, and reads token type or environment from a token prefix.

## What it does

- **`generateOpaqueToken(type)`**: Creates a random token with a Shipfox prefix.
- **`hashOpaqueToken(raw)`**: Returns a SHA-256 hash for storing token values.
- **`getTokenType(raw)`**: Reads the token type when the prefix matches the configured environment.
- **`getTokenEnvironment(raw)`**: Reads the token environment from the prefix.
- **`extractDisplayPrefix(raw)`**: Returns the first 12 characters for logs and UI.
- **`tokenTypeParts`**: Prefix map for supported token types.

Supported token types:

| Type | Prefix part |
| --- | --- |
| `apiKey` | `k` |
| `invitation` | `i` |
| `emailVerification` | `v` |
| `passwordReset` | `pr` |
| `refreshToken` | `r` |
| `runnerToken` | `rt` |

## Usage

```ts
import {generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';

const raw = generateOpaqueToken('apiKey');
const hashed = hashOpaqueToken(raw);

await db.insert(apiKeys).values({
  displayPrefix: raw.slice(0, 12),
  hashedToken: hashed,
});
```

Set `TOKEN_ENVIRONMENT` to add an environment part to new tokens:

```sh
TOKEN_ENVIRONMENT=staging
```

With that setting, an API key starts with `sf_staging_k_`. Prefix readers reject tokens from another configured environment.

> [!IMPORTANT]
> Store only the hash returned by `hashOpaqueToken`. Show the raw token once, when it is created.

## Development

```sh
turbo check --filter=@shipfox/node-tokens
turbo type --filter=@shipfox/node-tokens
turbo test --filter=@shipfox/node-tokens
```

## License

MIT
