# Shipfox Network Call Guard

A small rule for calls set by a user.

## What it does

- **`assertEgressAllowed(url, policy)`**: Stops a call when the place is not safe.
- **`EgressPolicy`**: Sets whether a private name or number can be used.
- **`EgressDeniedError`**: Gives the reason and place for a stopped call.
- **`parseEgressHostDenylist(value)`**: Reads a comma-separated block list.

## Installation and setup

```sh
pnpm add @shipfox/node-egress-guard
```

## Usage

```ts
import {assertEgressAllowed, parseEgressHostDenylist} from '@shipfox/node-egress-guard';

await assertEgressAllowed('https://models.example.test/v1', {
  allowPrivateNetworks: false,
  hostDenylist: parseEgressHostDenylist('metadata.google.internal,10.0.0.0/8'),
});
```

## Behavior notes

Use this when a user can set where Shipfox will send a call. This keeps the
call in the range the app means to allow.

Only `http:` and `https:` can pass.

When private networks are off, it will stop loopback, private, link-local,
metadata, and other non-public numbers. It will stop `.internal` names too.

The block list can use an exact name, suffix patterns such as
`.corp.example.test` or `*.corp.example.test`, IP numbers, and CIDR blocks.

This is one check before the real call. It is not the last rule for DNS or
redirects.

## Development

```sh
turbo check --filter=@shipfox/node-egress-guard
turbo type --filter=@shipfox/node-egress-guard
turbo test --filter=@shipfox/node-egress-guard
```

## License

MIT
