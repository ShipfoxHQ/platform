# Shipfox Auth Root Key

Named HKDF-SHA256 keys for Shipfox API authentication and email challenges.

## What it does

- **Root-key loading**: Reads and checks `AUTH_ROOT_KEY` before application startup.
- **Named keys**: Exports one key function for user tokens, job leases, runner sessions, rate-limit identifiers, and email challenges.
- **Fixed domains**: Uses versioned labels and a fixed salt so callers cannot select an arbitrary HMAC or signing domain.

## Installation

```sh
pnpm add @shipfox/node-auth-root-key
```

## Usage

```ts
import {jobLeaseTokenKey} from '@shipfox/node-auth-root-key';
import {signHs256} from '@shipfox/node-jwt';

const token = await signHs256({
  payload: {jobId},
  secret: jobLeaseTokenKey(),
  expiresIn: '90m',
});
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_ROOT_KEY` | none | Canonical base64 for exactly 32 random bytes. Generate it with `openssl rand -base64 32`. |

## Behavior notes

The package uses HKDF-SHA256 with the salt `shipfox/auth-root/v1`. Each function returns 32 bytes for one fixed label.

Changing `AUTH_ROOT_KEY` invalidates every token, email challenge, and rate-limit identifier derived from the old root. The package does not support rotating one derived key by itself.

## Development

```sh
turbo check --filter=@shipfox/node-auth-root-key
turbo type --filter=@shipfox/node-auth-root-key
turbo test --filter=@shipfox/node-auth-root-key
```

## License

MIT
