# @shipfox/node-log

## 0.3.8

### Patch Changes

- e23f70c: Preserves nested error cause details in local and OpenTelemetry logs for both `err` and `error` fields.

## 0.3.7

### Patch Changes

- 4425c6d: Adds independent stdout and file log thresholds and enables standard OpenTelemetry Pino log export in the API instrumentation preload.

## 0.3.6

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/config@1.2.4

## 0.3.5

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/config@1.2.3

## 0.3.4

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/config@1.2.2

## 0.3.3

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
- Updated dependencies [1b0d344]
  - @shipfox/config@1.2.1

## 0.3.2

### Patch Changes

- e47f8da: Documents every environment-variable config param with a `desc` field so self-hosters can see what each variable does and how to set it.
  - @shipfox/config@1.2.0

## 0.3.1

### Patch Changes

- a2b9add: Add flag to control stdout

## 0.3.0

### Minor Changes

- fa38530: Log to file and stdout a the same time + expose flush

## 0.2.0

### Minor Changes

- 2b64d6d: Expose the package's config for users of the library

### Patch Changes

- 674ecbb: Add README for all packages
- Updated dependencies [89dc459]
- Updated dependencies [674ecbb]
  - @shipfox/config@1.2.0

## 0.1.0

### Minor Changes

- 0de5d1a: Backport pino formatting and serialization to open source
- f0687b7: Handle logging to a file instead of stdout

### Patch Changes

- 9bd640b: Modify repository structure
- Updated dependencies [9bd640b]
  - @shipfox/config@1.1.1
