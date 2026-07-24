# @shipfox/node-mailer

## 0.2.3

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/config@1.2.4
  - @shipfox/node-opentelemetry@0.6.2

## 0.2.2

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/config@1.2.3
  - @shipfox/node-opentelemetry@0.6.1

## 0.2.1

### Patch Changes

- Updated dependencies [6ce08c0]
  - @shipfox/node-opentelemetry@0.6.0

## 0.2.0

### Minor Changes

- 7366f04: Adds a configured shared mailer that owns SMTP delivery settings. `@shipfox/api-auth` and `@shipfox/api-workspaces` drop their own mailer environment variables and factory logic and use the shared `mailer` from `@shipfox/node-mailer` instead.

## 0.1.4

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/node-opentelemetry@0.5.2

## 0.1.3

### Patch Changes

- Updated dependencies [7a71e7d]
  - @shipfox/node-opentelemetry@0.5.1

## 0.1.2

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-opentelemetry@0.5.0

## 0.1.1

### Patch Changes

- Updated dependencies [e47f8da]
- Updated dependencies [7b175f5]
  - @shipfox/node-opentelemetry@0.4.2
