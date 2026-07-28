# External client runtime fixture

This fixture packs the published client runtime closure into a Vite application outside the pnpm
workspace. The application starts from `defaultFeatures()` and adds external features that replace
the login route, add a settings route, append providers, contribute navigation and settings entries,
merge a config fragment, and compose a layout with child routes from a separate feature.

## Run the required packed gate

The Turbo task builds runtime files and declarations from a clean checkout. It then packs the full
client closure:

```sh
turbo test:external --filter=@shipfox/client-shell
```

The gate installs only the nine documented client composition roots, plus
`@shipfox/client-config` used by the fixture's own config proof, as direct dependencies. It uses
release-shaped local tarballs and overrides for the full `@shipfox/*` runtime closure. It verifies
that generated package imports are declared direct dependencies, checks default and `development`
condition resolution through `dist`, type-checks every packed declaration graph, generates the
composed TanStack router, builds and type-checks the consumer, runs the behavioral fixture, and
asserts the exact rejected-collision diagnostic. CI runs this command during static verification.
The fixture also renders deterministic layout-local links from packed public runtime exports.

## Run the linked iteration mode

```sh
turbo test:external --filter=@shipfox/client-shell -- --link
```

This copies the Vite template to a temporary directory and links the workspace-built closure. It
runs the same minimal-consumer, generated-route, behavior, collision, and type assertions without
packing tarballs. The packed-only `development` check is omitted because linked workspace packages
intentionally resolve that condition to source.

Both modes remove their temporary directories after completion. The behavioral composition fixture
uses Vitest with JSDOM and does not need browser E2E infrastructure.
