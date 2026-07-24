# @shipfox/node-outbox

## 0.2.6

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/node-drizzle@0.3.4

## 0.2.5

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/node-drizzle@0.3.3

## 0.2.4

### Patch Changes

- 7ac43a4: Consolidates packed-consumer validation around stable publication and composition contracts instead of package-state snapshots.
- Updated dependencies [7ac43a4]
  - @shipfox/node-drizzle@0.3.2

## 0.2.3

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/node-drizzle@0.3.1

## 0.2.2

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0

## 0.2.1

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
- Updated dependencies [1b0d344]
  - @shipfox/node-drizzle@0.2.1

## 0.2.0

### Minor Changes

- 705dd43: Publishes the supported PostgreSQL outbox API with external-consumer verification and operational documentation.

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
  - @shipfox/node-drizzle@0.2.0

## 0.1.0

### Minor Changes

- 5729548: Stuck-job expiry now reaps a bounded batch in one transaction instead of N+1: a single `DELETE … RETURNING` (oldest-first, `FOR UPDATE SKIP LOCKED`, capped at 100 per tick) feeds a multi-row outbox insert via the new `writeOutboxEvents` helper. Behavior is unchanged (same rows reaped, one `runners.job.lease_expired` event per reaped job, same orphan-pending sweep).

### Patch Changes

- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- Updated dependencies [5707d6d]
- Updated dependencies [6077301]
  - @shipfox/node-drizzle@0.1.0
