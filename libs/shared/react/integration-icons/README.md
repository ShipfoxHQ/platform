# Shipfox Integration Icons

The source-to-icon mapping for integration providers (GitHub, Sentry, Linear,
Slack, Gitea, generic webhooks), plus the `IntegrationIcon` component that
renders it. This is a leaf package: no routing, no connection state, no
business logic, presentation data only, which any client feature can depend on.

## What it does

- **`PROVIDER_ICONS`** maps a provider key to its `IconName`.
- **`getIntegrationIcon(source)`** resolves a source string to an `IconName`,
  falling back to a neutral glyph for unknown or empty sources.
- **`IntegrationIcon`** renders the resolved icon via `@shipfox/react-ui`'s
  `Icon`, forwarding the rest of its props.

Feature packages that also need provider-specific routing or connection
metadata (setup paths, connect flows) keep that data in their own module and
derive their icon from `PROVIDER_ICONS` rather than redeclaring it, so there
is one place to update when a provider's icon changes.

## Installation

```bash
pnpm add @shipfox/integration-icons
```

## Usage

```tsx
import {IntegrationIcon, getIntegrationIcon} from '@shipfox/integration-icons';

getIntegrationIcon('github'); // 'github'

<IntegrationIcon source="github" aria-label="GitHub" />;
```

## Development

```sh
turbo check --filter=@shipfox/integration-icons
turbo type --filter=@shipfox/integration-icons
turbo test --filter=@shipfox/integration-icons
```

## License

MIT
