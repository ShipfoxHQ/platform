# @shipfox/preview

CI tools for building and publishing static previews.

## What it does

- **`shipfox-preview plan`** checks Turbo targets and changed paths for each app.
- **`shipfox-preview deploy-all`** uploads each selected app to its configured
  project. Cloudflare Pages Direct Upload is the first provider.
- **`shipfox-preview verify-all`** checks each app URL, metadata, and JSON
  endpoints.
- **`shipfox-preview github`** checks the current pull-request commit and
  updates a GitHub deployment.
- **`shipfox-preview summary`** writes a GitHub Actions job summary.

The CLI has a provider-neutral boundary. Provider adapters keep host details in
one place. A new static host can use the same application workflow.

## Installation

```sh
pnpm add -D @shipfox/preview
```

The Cloudflare adapter expects `wrangler` on `PATH`, `CLOUDFLARE_API_TOKEN`,
and `CLOUDFLARE_ACCOUNT_ID`. Project names are application configuration, not
secrets.

The published package contains compiled output. In this workspace, CI builds
it on demand with `pnpm --filter=@shipfox/preview... build` before invoking the
CLI, which also builds its workspace build helpers.

## Usage

Create an application config. Directories are resolved from the working
directory where the CLI runs:

```json
{
  "apps": [
    {
      "id": "example",
      "target": "@shipfox/example",
      "directory": "dist/example",
      "provider": {
        "type": "cloudflare-pages",
        "project": "example-preview"
      },
      "verify": {
        "metadataPath": "/preview-metadata.json",
        "endpoints": ["/index.json"]
      }
    }
  ],
  "forcePaths": ["apps/example", ".github/workflows/preview.yml"]
}
```

Turbo selects apps through their `target` package. Main pushes and changes to
`forcePaths` select all configured apps. Each app is uploaded to its own
provider project, verified against the exact source commit, and shown as a
separate GitHub deployment and summary row.

`apps` describes deployable sites, not necessarily every package rendered by a
site. A composed site can use `affectedTargets` to list the packages whose
changes require rebuilding that one deployment.

Use it in CI:

```sh
shipfox-preview plan \
  --config preview-deploy.config.json \
  --output "$RUNNER_TEMP/preview-plan.json" \
  --github-output "$GITHUB_OUTPUT"

shipfox-preview deploy-all \
  --config preview-deploy.config.json \
  --plan-file "$RUNNER_TEMP/preview-plan.json" \
  --commit "$PREVIEW_COMMIT_SHA" \
  --output "$RUNNER_TEMP/preview-deployments.json" \
  --github-output "$GITHUB_OUTPUT"

shipfox-preview verify-all \
  --config preview-deploy.config.json \
  --plan-file "$RUNNER_TEMP/preview-plan.json" \
  --deployments-file "$RUNNER_TEMP/preview-deployments.json" \
  --output "$RUNNER_TEMP/preview-verification.json"
```

## Development

```sh
pnpm run build
turbo check --filter=@shipfox/preview
turbo test --filter=@shipfox/preview
```

## License

MIT
