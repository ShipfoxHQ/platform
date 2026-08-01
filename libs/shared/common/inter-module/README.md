# Shipfox Inter-Module

Browser-safe, Zod-only primitives for defining a producer-owned inter-module
contract: stable method names, JSON-safe input/output schemas, and kebab-case
known errors.

For repository-wide backend module layering and dependency-boundary rules, read
the [backend architecture guide](../../../../docs/architecture/backend-architecture.md).
This README owns the package API and local constraints for defining and
consuming inter-module contracts.

This package defines contracts and clients. It never validates JSON safety,
serializes a call, or dispatches one. That is a transport's job. The in-memory
transport lives in `@shipfox/node-module/inter-module`.

## What it does

- **`defineInterModuleContract({module, methods})`** declares a producer's
  contract: one stable module name plus, per method, an `input` schema, an
  `output` schema, and an optional map of kebab-case error codes to detail
  schemas.
- **`createInterModuleClient(contract, dispatch)`** builds a typed client over
  any `dispatch` function. This is the seam a transport author implements.
  The in-memory transport, a fake test presentation, and a future network
  transport all produce a client this same way.
- **`defineInterModulePresentation(contract, handlers)`** closes a producer's
  domain code over its own contract, one handler per declared method.
- **`createInterModuleKnownError(methodContract, code, details)`** mints a
  known error for one method, validating `details` against that code's schema.
- **`isInterModuleKnownError(methodContract, error)`** narrows an unknown value
  to the method's discriminated known-error union. It never uses `instanceof`:
  it re-validates a non-enumerable marker, the module/method identity, and the
  code's details schema, so a forged error or a duplicate installed copy of
  this package still narrows correctly (or correctly fails to).

## Exhaustively switching on a known-error code

Switch on the destructured code, not the `error.code` property access directly.
TypeScript only narrows a `switch` discriminant to `never` in an exhaustive
`default` when it is a plain local: a dotted expression narrows each `case`
but never reaches `never`, so a `const exhaustive: never = error.code;` check
fails to compile even when every code is handled:

```ts
if (isInterModuleKnownError(widgetsInterModuleContract.methods.getWidget, error)) {
  const {code} = error;
  switch (code) {
    case 'not-found':
      return handleNotFound(error.details);
    case 'conflict':
      return handleConflict(error.details);
    default: {
      const exhaustive: never = code; // compiles; add a case above if this errors
      throw new Error(`Unhandled known error code: ${exhaustive}`);
    }
  }
}
```

## Error-detail schemas must not reshape their input

`isInterModuleKnownError` re-validates `error.details`, already the code's
schema *output*. It re-parses it through that same schema. An error-detail
schema's input and output shapes must therefore stay identical (a plain
`z.object({...})`, no shape-changing `.transform()`/`.pipe()`).
`createInterModuleKnownError` enforces this at mint time: it throws
immediately if the schema doesn't round-trip, rather than minting a known
error that would silently fail to narrow later.

## Contract identity, not names

A client and a presentation must be built from the exact same contract object
returned by `defineInterModuleContract`. Two calls with identical module and
method names produce two different objects on purpose: a transport's `seal()`
rejects a presentation that does not reference the same object a client used,
so a producer and a caller can never silently cross-wire onto a
same-named-but-different contract.
