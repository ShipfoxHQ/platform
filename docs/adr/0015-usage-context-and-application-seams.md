# Architecture decision record 0015: Usage context and application seams

- **Status:** Accepted.
- **Date:** 2026-09-03.
- **Decision owners:** Server architecture, client composition maintainers, and job admission.
- **Linear issue:** [ENG-1900](https://linear.app/shipfox/issue/ENG-1900/record-the-usage-context-analytics-boundary-pricing-seam-and-admission).
- **Amends:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md)
  and [ADR 0002: Server inter-module architecture](0002-api-inter-module-architecture.md).
- **Related:** [ADR 0006: Database ownership boundaries](0006-database-ownership-boundaries.md),
  [ADR 0008: Administration controls](0008-administration-controls.md), and
  [ADR 0013: Workspace setup composition seams](0013-workspace-setup-composition-seams.md).

## Context

**Usage facts are spread across three owners.** Job execution timestamps live in Workflows.
Runner identity lives in Runners. Inference requests live in the gateway that served them. No
context owns a durable record per job execution or per inference segment. A consumer would have
to correlate raw lifecycle events across the three owners. It could never replay a period after
the outbox prunes dispatched rows.

**The composition contracts have no seam for usage.** The ADR 0002 context map lists the
contexts as of 2026-07-19 and has no Usage context. The ADR 0001 client composition contract has
one optional application-provided implementation, `ClientAnalytics` from ADR 0013, and no seam
for pricing. The job-admission inventory has one gate, the Workspace operating state, and no way
for a composition root to add its own admission rule.

## Decision

**This record introduces the Usage bounded context and names what a composing application can
instrument from outside it.** It defines architecture contracts only. Later work implements them
in `@shipfox/api-usage`, `@shipfox/api-usage-dto`, `@shipfox/client-usage`,
`@shipfox/client-shell`, `@shipfox/api-workflows`, and `@shipfox/api-triggers`.

### What the Usage context does

**Usage owns canonical usage facts.** It is a new bounded context in the ADR 0002 map:

| Bounded context | Packages |
| --- | --- |
| Usage | `@shipfox/api-usage`, `@shipfox/api-usage-dto`, and `@shipfox/client-usage`. |

The context owns two kinds of record:

| Record | Fields |
| --- | --- |
| Job execution | Opaque ids down to the job execution. Requested and runner labels. Template key, provisioner id and scope, provider kind, and launch kind. Queued, started, finished, and lease-expired times. Status, duration, and state. |
| Inference segment | A producer-supplied segment key. Opaque ids down to the step attempt. Upstream, model, and response dialect. An hour window, a request count, and the reported token classes. |

**Facts come from committed events and one inter-module command.** Usage subscribes to
`workflows.job_execution.queued`, `runners.job.claimed`, `runners.job.lease_expired`, and
`workflows.job_execution.terminated`. Every handler is an idempotent write keyed on the
producer's ids. Handlers are commutative, because Workflows and Runners events order on
different keys. An inference source records segments through `recordInferenceSegments` in the
`@shipfox/api-usage-dto/inter-module` export, idempotent by segment key.

**Usage reads no peer table and calls no peer contract.** It depends on the Workflows and Runners
events being self-sufficient. The terminated event carries every field a usage record needs, so
a late claimed event only fills display fields.

**Usage publishes two outbox events.** `usage.job_execution.recorded` orders on the workflow run
id. `usage.inference_segment.recorded` orders on the step attempt id. Each is published once, in
the same transaction as the row, guarded by the row's `recorded_at`. Both payloads carry the full
record.

**Usage exposes per-entity read routes only.** One route returns the usage of a workflow run.
One route returns the usage of a job execution. There is no per-definition list route, and the
workflow runs list carries no usage data. Aggregates such as period totals, time series, or
top-N views are out of scope for this context. They need their own tables and retention, and a
consumer builds them from the events and list cursors below.

**Usage holds quantities, never amounts.** No table, event, route, DTO, or client component in
the context carries a price, an amount, a currency, or a rate.

**The context follows the existing ownership rules.** Its database namespace is `usage` and its
tables use the `usage_` prefix under ADR 0006. It is classified in `api-contexts.cjs` as `usage`,
with `libs/api/usage` as the implementation and `libs/api/usage-dto` as the DTO package. The
application root registers it in the default module set before the dispatcher, so its
subscribers are live before any enriched event flows.

### What can be instrumented from outside

Three points let a composing application build on Usage without changing upstream code.

#### Events and list cursors

A consumer subscribes to the two `usage.*` events through the dispatcher, and replays a period
through `listJobExecutionUsage` and `listInferenceSegments` in the inter-module export. It
depends only on `@shipfox/api-usage-dto`. Usage rows are the durable record; replay never depends
on the outbox.

#### The `usagePricing` client seam

**`composeClientApp()` accepts an optional `usagePricing` implementation.** Features read it
through `useUsagePricing()` from `@shipfox/client-shell/runtime`. The seam follows the
`ClientAnalytics` precedent from ADR 0013: an application-provided implementation, optional at
composition, with no default implementation in the shell.

The interface has three operations:

| Operation | Purpose |
| --- | --- |
| `resolveCosts(refs)` | Batched resolved amounts for job executions, step attempts, or runs. |
| `estimate(input)` | An estimate for in-flight or unresolved work from the application's current rates. |
| `formatMoney(amount)` | Locale and currency formatting owned by the implementation. |

**Usage components render quantities only when the seam is absent.** A cost column, total, or
chip appears only when the seam returns a value for that entity. Each cost shows one of three
states. `resolved` means the implementation holds a final amount. `estimated` covers work in
flight or work without a final amount. Absent means no pricing is composed. Components in
`@shipfox/client-usage` never import an application package and never compute an amount from a
hard-coded price.

**A failing implementation degrades to the absent state.** A thrown error or rejected promise
from the implementation cannot break a run or job page. The shell isolates the failure the way
it isolates analytics failures, and the affected components render quantities for that request.

#### The workflow admission policy seam

**`createWorkflowsModule` accepts an optional admission policy.** The option has the same shape
as the Runners installation provisioning policy. It is an optional object with one `policy` field
on the module factory. The default composition threads it through its module options. No policy
configured means admit, so existing behavior is unchanged.

The policy has one method:

```ts
interface WorkflowAdmissionPolicy {
  admit(input: {workspaceId: string; source: string; definitionId: string}): Promise<
    {allowed: true} | {allowed: false; reason: string; requiredAction?: RequiredAction}
  >;
}

interface RequiredAction {
  reason: string;
  message: string;
  url: string;
}
```

`reason` is a stable kebab-case code owned by the policy, such as `workspace-quota-exhausted`.
`requiredAction` tells a user what to do and where. Every surface that shows a denial renders
that one object rather than inventing its own text.

**Workflows calls the policy beside the operating-state gate.** Every path in the job-admission
inventory calls it: manual run, scheduled run, integration webhook to a trigger, listener `fire`
deliveries, and rerun. `resolve` deliveries stay exempt because they terminate existing listener
work. The operating-state gate runs first. A suspended workspace reports `workspace-suspended`,
never a policy reason, so administrator suspension under ADR 0008 stays separate from any
application policy.

**A denial is permanent and recorded.** Workflows returns the denial to its caller as one known
error, `admission-denied`, on `startRunFromTrigger`, `startDevRun`, and
`deliverEventToJobListener`. Its details carry the workspace id, the `reason`, and the optional
`requiredAction`. Triggers records the denial in trigger history and skips the event, the way it
records `workspace-suspended` today. It never retries a denial and never queues work for it.
Manual starts and reruns surface the reason and `requiredAction` in the HTTP response as a stable
error code with details.

**The policy vocabulary lives in `reason`, not in error codes.** A new policy reason never adds a
known error to the contract. Under ADR 0002, adding the `admission-denied` known error is a
breaking contract change once, and the release that adds it follows that rule. Later reasons are
additive.

**A policy failure is transient, not a denial.** A policy that throws is an unknown failure.
Callers keep their existing retry behavior, so a policy outage delays work instead of discarding
it. Only an explicit `allowed: false` result is permanent.

**Upstream records no policy state.** The policy owner records its own side effects. Workflows
and Triggers store the reason string and nothing else about the policy.

### Admission is decided server-side only

The client sends the request and renders the `requiredAction` the server returns. It does not
check a policy before it starts a run. It shows no blocking dialog at launch time and never
disables a run action from a policy fact. Runs are triggered by external events as often as by a person, so a
client gate would cover a minority of admissions. The server must enforce the decision anyway,
and a second copy of the rule would drift. A composing application informs users through the
existing `ChromeSlots.SessionBanner` and `ChromeSlots.WorkspaceSetupChecklist` slots.

### Amendments

**ADR 0001 gains the `usagePricing` seam.** `composeClientApp()` accepts a second optional
application-provided implementation beside `clientAnalytics`. The rules from ADR 0013 apply:
optional at composition, isolated failures, no default implementation.

**ADR 0002 gains the Usage context.** The current context map now lives in the
[backend architecture guide](../architecture/backend-architecture.md#bounded-contexts), with
`api-contexts.cjs` as its executable source. The table in ADR 0002 remains the map as of its
date. ADR 0002's rule that a context enters the map before its code still applies; this record
is that entry for Usage.

## Consequences

- Upstream gains one context with three packages, four subscribers, three inter-module methods,
  two events, and two routes. A consumer needs only the DTO package.
- The enriched Runners and Workflows events are a prerequisite. Usage subscribers ship in the
  same release as those events, because an event with no subscriber is pruned after seven days.
- The client shell owns a second optional implementation seam, and usage components carry three
  cost states in their stories and tests.
- Every admission path makes two decisions. The Workflows inter-module contract gains one known
  error, a breaking change under ADR 0002. Trigger history gains a new reason family.
- No upstream package models a consumer's pricing or admission rules.
- `api-contexts.cjs` classifies Usage when its packages land. Until then the file carries a note
  reserving the classification, because the inventory check rejects a path that does not exist.
- This record gates the implementation sequence: the Usage context, the client seam and usage
  views, and the admission seam and its release.

## Rejected alternatives

### A consumer correlates raw lifecycle events itself

**Correlation would live in the wrong place and could not be replayed.** A consumer would depend
on Workflows and Runners internals and lose its input after the seven-day outbox prune. One
correlation, owned upstream and stored durably, serves every consumer.

### Store usage facts in Workflows or Runners

**Neither context owns a metering record.** Workflows owns run orchestration and Runners owns
capacity. A usage record outlives both, carries a long retention, and receives inference segments
from a source outside either context.

### Add aggregate reads to the Usage context

**Aggregates are a different scale problem.** Summary tables, time series, and top-N views need
their own tables, retention, and refresh cadence. Mixing them into the per-entity context would
couple its retention and partitioning to analytics needs.

### Let the client compute amounts from a rates route

**The shell would then own currency, rounding, and the shape of a rate.** Amount formatting and
estimation belong to the implementation that owns prices. The seam keeps the shell neutral and
lets an application change its pricing without an upstream release.

### A run-time client gate

**A client check does not cover external triggers and cannot be trusted.** Webhooks, schedules,
and listeners never pass through the client. The server must decide anyway, and a client copy of
the rule drifts from it.

### One known error per policy reason

**Every new reason would be a breaking change.** ADR 0002 treats a new known error as breaking.
One `admission-denied` code with an open `reason` vocabulary pays that cost once.

### A policy status inside the Workspace operating state

**Workspaces would own an application fact.** Suspension is an administrator decision under
ADR 0008. An application admission rule is a decision that upstream must not model. Two gates
with two owners keep the reasons distinct and the trigger history honest.

### A generic admission policy chain

**One policy object is enough.** A list of policies with ordering rules and result merging is
abstraction without a second consumer. The Runners installation provisioning policy set the
precedent: one optional object, one method, host-owned.
