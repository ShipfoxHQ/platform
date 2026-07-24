# @shipfox/regex

## 0.2.4

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 0.2.3

### Patch Changes

- 8436596: Adds Dependency Cruiser checks to all classified API packages so source-edge enforcement remains active after retiring the duplicate import scan.
- 475ce59: Republishes all public packages after restoring release authorization.

## 0.2.2

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 0.2.1

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.2.0

### Minor Changes

- 7b175f5: Adds shared identifier regex helpers and migrates public OpenTelemetry UUID route normalization to the canonical matcher.
- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
