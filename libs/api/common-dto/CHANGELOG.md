# @shipfox/api-common-dto

## 15.0.0

### Patch Changes

- Updated dependencies [a7804a8]
  - @shipfox/regex@0.3.0

## 12.0.0

### Minor Changes

- 34a5639: Add the shared resource slug schema and name-derived slug helpers.

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.

## 9.2.0

### Minor Changes

- 36d8338: Adds the checked, redacted administration-action outbox event contract and constructor.

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/regex@0.2.4

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/regex@0.2.3

## 6.0.0

### Minor Changes

- 4a91956: Publishes a shared provider-neutral `emailSchema` in `@shipfox/api-common-dto` and adopts it across auth and workspace invitation inputs. Adds a read-only `findUserByEmail`/`EmailOwner` seam to `@shipfox/api-auth` for looking up the current owner of a normalized email without creating a session or mutating that user. Extends the packed external consumer gate to exercise both seams against PostgreSQL through installed tarballs.

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/regex@0.2.2

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/regex@0.2.1

## 0.1.0

### Minor Changes

- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.

### Patch Changes

- Updated dependencies [7b175f5]
- Updated dependencies [27770eb]
  - @shipfox/regex@0.2.0
