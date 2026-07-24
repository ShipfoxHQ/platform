# @shipfox/inter-module

## 0.2.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 0.2.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.

## 0.2.0

### Minor Changes

- 81f9544: Adds the registered in-memory inter-module transport: browser-safe contract primitives in `@shipfox/inter-module` (`defineInterModuleContract`, `defineInterModulePresentation`, known-error branding) and `@shipfox/node-module/inter-module` (`createInMemoryInterModuleTransport`, module integration, and a framework-neutral fake-presentation test harness). Extends the packed external-consumer check to cover the new package.
