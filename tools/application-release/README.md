# @shipfox/application-release

Creates a manifest for one complete Shipfox app release.

## What it does

- **Release contract**: Records the source, build, publish time, and image
  digests, plus the exact published package name/version set.
- **OCI image checks**: Finds each digest and checks the source label on every
  platform.
- **Version 1 schema**: Rejects missing images, extra fields, and deployment
  data.

## Installation

```sh
pnpm add -D @shipfox/application-release
```

The command needs [ORAS](https://oras.land/) on `PATH`. ORAS reads images from
an Open Container Initiative (OCI) registry. Log in before reading a private
registry.

## Usage

```sh
shipfox-application-release create \
  --source-repository https://github.com/ShipfoxHQ/shipfox \
  --revision 0123456789abcdef0123456789abcdef01234567 \
  --build-system github-actions \
  --build-id 123456789 \
  --build-number 42 \
  --build-attempt 1 \
  --build-started-at 2026-07-13T15:30:00Z \
  --build-url https://github.com/ShipfoxHQ/shipfox/actions/runs/123456789 \
  --image-tag build-42 \
  --output application-release.json
```

## Manifest contract

[`schema/v1.schema.json`](schema/v1.schema.json) defines version 1. The manifest
uses `kind: shipfox.application-release` and `apiVersion: v1` as its type.

The contract contains these required image repositories:

- `ghcr.io/shipfoxhq/api`
- `ghcr.io/shipfoxhq/client`
- `ghcr.io/shipfoxhq/provisioner-docker`
- `ghcr.io/shipfoxhq/runner`

Changing this required set creates a new contract version. Publishing another
image in CI does not add it to this contract.

The repository-level [`publication-closure.json`](../../publication-closure.json)
declares the complete API and client runtime package set and expected recursive runtime
closure. Release creation recalculates that closure from workspace runtime
dependencies, optional dependencies, and peer dependencies, rejects drift, and
records each package's current version.
Versions from different application-release artifacts are not a supported set.

The same validation rejects a public package with a private runtime workspace
dependency. The API gate packs the Node-composed API closure, and the client gate packs the
browser client closure before building a Vite consumer. Together they install all tarballs in a
temporary consumer outside the workspace and resolve public declaration and runtime entry points.

Packages can add packed-consumer checks under `test/published/`. The API gate discovers these
files from the publication closure: `.ts` files are type-checked, `.mjs` files are executed, and
`.development.mjs` files run with Node's `development` condition. The API server owns the single
`_environment.mjs` provider used by runtime checks. This keeps feature contracts beside their
owners without adding a central package or entry-point list to the release tool.

Each image has a repository, digest, platform list, and attestation state. The
image build does not publish provenance or a software bill of materials (SBOM)
today. Both fields use `status: not-published` until those OCI artifacts exist.

## Behavior notes

The command only writes JSON. CI decides where to store the file. It uses the
full source revision as the OCI artifact tag. Another OCI registry can store
the same file.

The current workflow stores releases in
`ghcr.io/shipfoxhq/application-releases`. The artifact and JSON file use
`application/vnd.shipfox.application-release.v1+json` as their media type.
The first successful publish owns the full source revision tag. A workflow
rerun reuses that artifact and only moves `latest`, so the revision tag does
not change.

Version-only `main` commits reuse the previous commit's immutable image
digests. Their manifest keeps the new source revision and records the previous
image revision in `artifactReuse` with reason `version-only-main-commit`.

`build.startedAt` records when CI starts. `publishedAt` records when all image
checks finish.

## Development

```sh
turbo check --filter=@shipfox/application-release
turbo type --filter=@shipfox/application-release
turbo test --filter=@shipfox/application-release
turbo build --filter=@shipfox/application-release
turbo verify --filter=@shipfox/application-release
turbo test:external --filter=@shipfox/application-release --filter=@shipfox/client-shell --concurrency=1
pnpm run release:preflight
```

## License

MIT
