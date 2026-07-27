# @shipfox/cloudflare-pages

CI tooling for deploying one or more prebuilt applications to Cloudflare Pages
through Wrangler Direct Upload.

## What it does

- `shipfox-cloudflare-pages plan` selects affected applications with Turbo and
  changed paths.
- `shipfox-cloudflare-pages build-all` builds the selected applications with
  their configured environment inputs.
- `shipfox-cloudflare-pages validate` runs the optional configured local
  artifact check.
- `shipfox-cloudflare-pages archive-all` stages selected outputs for CI
  artifacts.
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

The tool works only with Cloudflare Pages. One config can list several apps and
environments. The CLI keeps Pages terms such as projects and branches visible.

## Installation / Setup

```sh
pnpm add -D @shipfox/cloudflare-pages
```

The tool expects `wrangler` on `PATH`. Upload commands also need
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Project names belong in the
config because they are not secrets.

The published package contains compiled output. In this workspace, CI builds it
on demand with:

```sh
pnpm --filter=@shipfox/cloudflare-pages... build
```

## Configuration

Application directories and artifact paths stay relative to the working
directory where the CLI runs:

```json
{
  "environments": {
    "preview": { "branch": "pr-{pullRequest}" },
    "staging": { "branch": "staging" },
    "production": { "branch": "main" }
  },
  "artifact": {
    "metadataPath": "dist/example/preview-metadata.json"
  },
  "validation": {
    "setup": {
      "command": "pnpm",
      "args": ["--filter=@shipfox/playwright", "exec", "playwright", "install", "--with-deps", "chromium"]
    },
    "command": "pnpm",
    "args": ["--filter=@shipfox/example", "test:e2e"]
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

Key config rules:

- `project` is the default Pages project. `projects` sets an override for one
  environment.
- Production should name its Pages branch. The CLI passes that branch to
  Wrangler.
- `build.env` stores non-secret build values by environment. The build command
  fills the `{pullRequest}`, `{branch}`, and `{commit}` placeholders.
- `build.fromEnv` reads a value from a CI environment variable. A missing value
  stops the build before Turbo starts.
- Each build variable must also appear in the Turbo task's `env` array. Turbo
  can then include the value in its task hash.
- `apps` lists sites, not every package shown by a site. Use `affectedTargets`
  when another package should rebuild the site.
- `validation` is optional. Its `setup` command runs before the main check.

`archive-all` replaces its target directory. It rejects roots, parents of the
working directory, output overlaps, and unsafe app IDs. The result contains a
deployment plan.

`deploy-all --artifact-directory` publishes that archive without a rebuild. It
rejects links and `_worker.js` files. An approved static preview therefore
cannot add Pages worker code.

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

shipfox-cloudflare-pages validate \
  --config cloudflare-pages.config.json

shipfox-cloudflare-pages archive-all \
  --config cloudflare-pages.config.json \
  --artifact-directory "$RUNNER_TEMP/pages-artifact" \
  --output "$RUNNER_TEMP/pages-artifact/.shipfox-pages-plan.json"

shipfox-cloudflare-pages deploy-all \
  --environment preview \
  --config cloudflare-pages.config.json \
  --plan-file "$RUNNER_TEMP/pages-artifact/.shipfox-pages-plan.json" \
  --artifact-directory "$RUNNER_TEMP/pages-artifact" \
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
