# Shipfox Regex

Shared regex matchers for stable Shipfox identifier shapes. One home for the
small validation patterns that are used across multiple packages so they cannot
drift.

## What it does

- **`isUuid(value)`** checks a dashed UUID-shaped identifier, case-insensitive.
  It is structural on purpose: Shipfox stores internal IDs as UUIDs and should
  not reject a future UUID version when the caller only needs a safe identifier
  shape.
- **`isLowercaseAlphaSlug(value)`** checks provider-style ids that start with a
  lowercase ASCII letter and then use lowercase letters, numbers, `_`, or `-`.
- **`isAlnumSlug(value)`** checks source-style ids that start with an ASCII
  letter or number and then use letters, numbers, `_`, or `-`, case-insensitive.
- **`isLowercaseSha256Hex(value)`** checks the lowercase 64-character hex form
  emitted by Node's `crypto` SHA-256 digest.
- **`isSafeRefInput(value)`** rejects control and line-separator characters from
  branch and tag names before they cross a boundary.
- **`createShipfoxTokenPrefixRegexes(tokenTypeParts)`** builds the unqualified
  and environment-qualified Shipfox opaque-token prefix matchers from the token
  type parts owned by `@shipfox/node-tokens`.

The exported regexes intentionally do not use `g` or `y` flags, so repeated
`.test()` calls are stable.

## Installation

```bash
pnpm add @shipfox/regex
```

## Usage

```ts
import {isUuid, isLowercaseAlphaSlug} from '@shipfox/regex';

isUuid('028b2a9a-800e-485e-b33a-9af4e238508b');
isLowercaseAlphaSlug('github');
```

## Development

```sh
turbo check --filter=@shipfox/regex
turbo type --filter=@shipfox/regex
turbo test --filter=@shipfox/regex
```

## License

MIT
