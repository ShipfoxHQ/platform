# @shipfox/runner-labels

## 0.2.1

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.

## 0.2.0

### Minor Changes

- df2ed79: Add runner catalog parsing and one-pass label resolution.

## 0.1.3

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 0.1.2

### Patch Changes

- 8436596: Adds Dependency Cruiser checks to all classified API packages so source-edge enforcement remains active after retiring the duplicate import scan.
- 475ce59: Republishes all public packages after restoring release authorization.

## 0.1.1

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 0.1.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.0.1

### Patch Changes

- 61de795: Adds canonical runner label validation and default runner label fallback for workflow definition parsing.
