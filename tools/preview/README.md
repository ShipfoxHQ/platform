# @shipfox/preview

CI tools for building and publishing static previews.

## What it does

- **`shipfox-preview plan`** checks Turbo targets and changed paths.
- **`shipfox-preview deploy`** uploads a static directory. Cloudflare Pages
  Direct Upload is the first provider.
- **`shipfox-preview verify`** checks a URL, metadata, and JSON endpoints.
- **`shipfox-preview github`** checks the current pull-request commit and
  updates a GitHub deployment.
- **`shipfox-preview summary`** writes a GitHub Actions job summary.

The CLI has a provider-neutral boundary. Provider adapters keep host details in
one place. A new static host can use the same application workflow.

## Installation

```sh
pnpm add -D @shipfox/preview
```

The Cloudflare adapter expects `wrangler` on `PATH` and its normal environment
variables.

The published package contains compiled output. In a workspace, CI can build
it on demand with `pnpm --filter=@shipfox/preview build` before invoking the
CLI.

## Usage

Create an application config:

```json
{
  "targets": ["@shipfox/example"],
  "forcePaths": ["apps/example", ".github/workflows/preview.yml"],
  "verify": {
    "endpoints": [
      {"id": "example", "path": "/example/index.json", "requireNonEmpty": true}
    ]
  }
}
```

Endpoint IDs are shown in the GitHub Actions summary. Each row links to the
app preview and reports whether its endpoint was verified against the exact
source commit.

Use it in CI:

```sh
shipfox-preview plan \
  --config preview-deploy.config.json \
  --output "$RUNNER_TEMP/preview-plan.json" \
  --github-output "$GITHUB_OUTPUT"

shipfox-preview deploy \
  --provider cloudflare-pages \
  --directory dist \
  --project "$CLOUDFLARE_PAGES_PROJECT" \
  --commit "$PREVIEW_COMMIT_SHA" \
  --output "$RUNNER_TEMP/preview-deployment.json" \
  --github-output "$GITHUB_OUTPUT"

shipfox-preview verify \
  --config preview-deploy.config.json \
  --url "$PREVIEW_URL"
```

## Development

```sh
pnpm run build
turbo check --filter=@shipfox/preview
turbo test --filter=@shipfox/preview
```

## License

MIT
