# @shipfox/provisioner-core

The provider-agnostic core of a Shipfox provisioner: the control loop that turns
aggregate runner demand into started runners. Docker, and later Kubernetes or EC2,
plug in a provider adapter; everything else here is shared.

## What a provisioner does

A provisioner authenticates with a long-lived provisioner token, then runs two
independent loops:

- The convergence loop observes provider state, reports lifecycle, and handles
  termination intents.
- The demand loop builds capacity advertisements from the tracker, long-polls the
  API for count-based reservations, picks a local template for each reservation's
  labels, mints one single-use registration token per planned runner, and hands each
  planned runner to the provider's launcher.

It never reserves more than its templates have free capacity. Demand polling and
provider convergence run independently: a blocking demand poll does not delay
observation, reporting, assignment, or termination handling.

## Public API

- `startProvisioner({adapter})`: run the loop until a shutdown signal. The adapter
  supplies the provider's templates and its launcher.
- `ProvisionerAdapter`, `ProvisionerTemplate`, `LaunchRunner`, and `ProviderRunnerLaunch`
  are the contract a provider implements.
- `loggingLaunch`: a default launcher that records each planned runner without
  starting it (used until a provider ships a real launcher).
- `ProvisionerAuthenticationError`: thrown at startup when the token is rejected.

## Key pieces (internal)

- **Template selection** (`template-selection.ts`) is deterministic: when several
  templates satisfy a generic label set, the cheapest, then most specific, then
  lowest key wins. Reproducible and unit-tested.
- **Capacity planning** (`capacity.ts`) charges each reservation against free slots,
  filling the cheapest matching template first and spilling to the next.
- **The tick** (`tick.ts`) is one cycle, driven entirely by injected ports so it is
  deterministic to test.

A `ProvisionerTemplate` carries a provider-specific `spec` (a Docker image, a pod
spec) that the loop treats as opaque and only the launcher reads.
