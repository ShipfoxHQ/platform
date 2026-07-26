# @shipfox/cloudflare-pages

CI tooling for deploying one or more prebuilt applications to Cloudflare Pages
through Wrangler Direct Upload.

## What it does

- `shipfox-cloudflare-pages plan` selects affected applications with Turbo and
  changed paths.
- `shipfox-cloudflare-pages build-all` builds the selected applications with
  their configured environment inputs.
- `shipfox-cloudflare-pages deploy` uploads one static directory to a
  configured Cloudflare Pages project.
- `shipfox-cloudflare-pages deploy-all` uploads selected applications to their
  configured Cloudflare Pages projects.
- `shipfox-cloudflare-pages verify` checks one deployed URL, its commit
  metadata, and its configured JSON endpoints.
- `shipfox-cloudflare-pages verify-all` checks deployed URLs, commit metadata,
  and configured JSON endpoints.
- `shipfox-cloudflare-pages github` manages GitHub deployment lifecycle and
  queue timing.
- `shipfox-cloudflare-pages summary` writes a GitHub Actions job summary.

The tool is intentionally Cloudflare Pages-specific. It supports multiple
applications and deployment environments without hiding Pages concepts such as
projects, preview branches, and production deployments.

## Installation / Setup

```sh
pnpm add -D @shipfox/cloudflare-pages
```

The tool expects `wrangler` on `PATH`, `CLOUDFLARE_API_TOKEN`, and
`CLOUDFLARE_ACCOUNT_ID`. Project names are application configuration, not
secrets.

The published package contains compiled output. In this workspace, CI builds it
on demand with:

```sh
pnpm --filter=@shipfox/cloudflare-pages... build
```

## Configuration

Directories are resolved from the working directory where the CLI runs:

```json
{
  "environments": {
    "preview": { "branch": "pr-{pullRequest}" },
    "staging": { "branch": "staging" },
    "production": { "branch": "main" }
  },
  "apps": [
    {
      "id": "example",
      "target": "@shipfox/example",
      "directory": "dist/example",
      "project": "example",
      "projects": {
        "staging": "example-staging"
      },
      "build": {
        "env": {
          "preview": {
            "VITE_API_URL": "https://api-pr-{pullRequest}.example.test"
          },
          "staging": {
            "VITE_API_URL": "https://api.staging.example.test"
          },
          "production": {
            "VITE_API_URL": "https://api.example.test"
          }
        },
        "fromEnv": {
          "VITE_SENTRY_DSN": "VITE_SENTRY_DSN"
        }
      },
      "verify": {
        "metadataPath": "/deployment-metadata.json",
        "endpoints": ["/index.json"]
      }
    }
  ],
  "forcePaths": ["apps/example", ".github/workflows/cloudflare-pages.yml"]
}
```

`project` is the default Pages project. `projects` can override it for a
specific environment. Production deployments should name the Pages production
branch explicitly; a branch value deploys to that Pages branch.

`build.env` contains checked-in, non-secret build inputs by environment. The
`{pullRequest}`, `{branch}`, and `{commit}` placeholders are resolved by the
build command. `build.fromEnv` maps build variable names to CI environment
variables without storing their values in the repository. Missing references
fail before Turbo starts. The build command passes the resolved values to a
Turbo task for the app target; each app is built separately so apps may use
different values.

The application must also list every build-time variable in its Turbo task's
`env` array. This makes the value part of the task hash, so changing an API
URL cannot reuse an artifact built for another environment.

`apps` describes deployable sites, not necessarily every package rendered by a
site. A composed site can use `affectedTargets` to list packages whose changes
require rebuilding that one deployment.

## Usage

```sh
shipfox-cloudflare-pages plan \
  --config cloudflare-pages.config.json \
  --output "$RUNNER_TEMP/pages-plan.json" \
  --github-output "$GITHUB_OUTPUT"

shipfox-cloudflare-pages build-all \
  --config cloudflare-pages.config.json \
  --environment preview \
  --plan-file "$RUNNER_TEMP/pages-plan.json" \
  --output "$RUNNER_TEMP/pages-build.json"

shipfox-cloudflare-pages deploy-all \
  --environment preview \
  --config cloudflare-pages.config.json \
  --plan-file "$RUNNER_TEMP/pages-plan.json" \
  --commit "$CLOUDFLARE_PAGES_COMMIT_SHA" \
  --output "$RUNNER_TEMP/pages-deployments.json" \
  --github-output "$GITHUB_OUTPUT"

shipfox-cloudflare-pages verify-all \
  --config cloudflare-pages.config.json \
  --plan-file "$RUNNER_TEMP/pages-plan.json" \
  --deployments-file "$RUNNER_TEMP/pages-deployments.json" \
  --output "$RUNNER_TEMP/pages-verification.json"
```

## Development

```sh
pnpm run build
turbo check --filter=@shipfox/cloudflare-pages
turbo test --filter=@shipfox/cloudflare-pages
```

## License

MIT
