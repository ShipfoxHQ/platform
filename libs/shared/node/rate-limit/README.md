# Shipfox Rate Limit

Tools for Shipfox Node code that must stop too many calls in a short time. The app gives a key and a max count, then this code hides the key, asks app code to save one count, and says if the call must stop.

## What it does

- **`hashRateLimitIdentifier(params)`**: Makes an HMAC-SHA256 hash for a key.
- **`checkRateLimit(params)`**: Checks one short time window and uses `consume` to save one count.
- **`RateLimitExceededError`**: Says the call is blocked and when to try again.
- **`RateLimitUnavailableError`**: Says the check failed so the app can stop the call.
- **Types**: Gives `RateLimitPolicy`, `ConsumeRateLimitParams`, and `ConsumeRateLimitResult`.

## Installation

```sh
pnpm add @shipfox/node-rate-limit
```

## Usage

```ts
import {rateLimitIdentifierKey} from '@shipfox/node-auth-root-key';
import {checkRateLimit} from '@shipfox/node-rate-limit';

await checkRateLimit({
  action: 'login',
  scope: 'email',
  identifier: 'user@example.com',
  limit: 5,
  windowSeconds: 60,
  identifierSecret: rateLimitIdentifierKey(),
  identifierHashDomain: 'shipfox.auth.rate-limit.identifier.v1',
  consume: async (params) => {
    return await consumeRateLimitRow(params);
  },
  prune: async ({now}) => {
    await pruneExpiredRows(now);
  },
});
```

## Behavior notes

`checkRateLimit` uses a fixed window. A call can pass when the count is less than or equal to `limit`.

This package does not save the key that the app passes in. It passes only `identifierHmac` out.

Pruning runs in the background. A prune failure calls `onPruneFailure` when set, but it does not change a pass.

## Development

```sh
turbo check --filter=@shipfox/node-rate-limit
turbo type --filter=@shipfox/node-rate-limit
turbo test --filter=@shipfox/node-rate-limit
```

## License

MIT
