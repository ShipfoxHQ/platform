# @shipfox/node-pg

## 0.5.1

### Patch Changes

- 9f898d9: Waits for every pooled PostgreSQL connection to close before shared client shutdown completes.

## 0.5.0

### Minor Changes

- f13e8bb: Add Jira dynamic webhook registration and authenticated event ingestion through
  the shared stored-webhook workflow. Update the SPI webhook request exports and
  serialize Jira installation replacement across API replicas. Preserve Jira
  delivery identifiers and require lifecycle callbacks for registration. Remove
  the unused Jira webhook signing-secret configuration and allow HS256 verification
  at a supplied receipt time.

## 0.4.4

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/config@1.2.4

## 0.4.3

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/config@1.2.3

## 0.4.2

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/config@1.2.2

## 0.4.1

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
- Updated dependencies [1b0d344]
  - @shipfox/config@1.2.1

## 0.4.0

### Minor Changes

- 6a1fb54: Adds verified TLS modes and serverless pool timeout configuration with safe duplicate initialization.

## 0.3.2

### Patch Changes

- e47f8da: Documents every environment-variable config param with a `desc` field so self-hosters can see what each variable does and how to set it.
  - @shipfox/config@1.2.0

## 0.3.1

### Patch Changes

- 7f477b0: Export DatabaseError from node-pg

## 0.3.0

### Minor Changes

- a2d06a0: Release @shipfox/shipql-parser, @shipfox/react-ui, @shipfox/node-pg, @shipfox/biome

### Patch Changes

- 8c87fdd: Add keepalive default value for postgres
  - @shipfox/config@1.2.0

## 0.2.0

### Minor Changes

- d155424: Allow specifying maximum number of connection for Postgres client

### Patch Changes

- 674ecbb: Add README for all packages
- Updated dependencies [89dc459]
- Updated dependencies [674ecbb]
  - @shipfox/config@1.2.0

## 0.1.0

### Minor Changes

- 853d506: Update dependencies for PostgreSQL packages

### Patch Changes

- 9bd640b: Modify repository structure
- Updated dependencies [9bd640b]
  - @shipfox/config@1.1.1
