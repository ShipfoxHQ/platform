import type {z} from 'zod';
import type {InterModuleErrorSchemas, InterModuleMethodContract} from './contract.js';

/**
 * Interned process-wide so a known error minted by one installed copy of this
 * package is still recognized by another copy of the same package (a duplicate
 * dependency hazard `instanceof` cannot survive). Recognition never relies on
 * this symbol alone: `isInterModuleKnownError` re-validates the code and details
 * against the method's own schemas.
 */
const KNOWN_ERROR_MARKER = Symbol.for('@shipfox/inter-module/known-error');

export interface InterModuleKnownError<Code extends string = string, Details = unknown>
  extends Error {
  readonly module: string;
  readonly method: string;
  readonly code: Code;
  readonly details: Details;
}

export type InterModuleKnownErrorFor<Method extends InterModuleMethodContract> = {
  [Code in keyof Method['errors'] & string]: InterModuleKnownError<
    Code,
    z.output<Method['errors'][Code]>
  >;
}[keyof Method['errors'] & string];

interface MarkedError extends Error {
  module: string;
  method: string;
  code: string;
  details: unknown;
}

function hasKnownErrorMarker(error: unknown): error is MarkedError {
  return error instanceof Error && KNOWN_ERROR_MARKER in error;
}

/**
 * True when `error` carries the known-error marker, with no further
 * validation. A transport uses this narrow check to tell "never minted as a
 * known error" (an undeclared handler bug) apart from "minted, but fails
 * `isInterModuleKnownError`'s full re-validation" (a forged or malformed known
 * error). The two outcomes `isInterModuleKnownError` alone cannot distinguish.
 * The marker itself stays this package's implementation detail; callers
 * outside it must not reconstruct the `Symbol.for` key by hand.
 */
export function hasInterModuleKnownErrorMarker(error: unknown): boolean {
  return hasKnownErrorMarker(error);
}

/**
 * Mints a known error for `code`, validating `details` against the schema that
 * `methodContract` declares for that code. Throws a plain (unmarked) `Error` when
 * `code` is not declared or `details` fails its schema: that throw is a contract
 * defect at the call site, not a known error, and never carries the marker.
 */
export function createInterModuleKnownError<
  Method extends InterModuleMethodContract,
  Code extends keyof Method['errors'] & string,
>(
  methodContract: Method,
  code: Code,
  details: z.input<Method['errors'][Code]>,
): InterModuleKnownError<Code, z.output<Method['errors'][Code]>> {
  const schema = (methodContract.errors as InterModuleErrorSchemas)[code];
  if (!schema) {
    throw new Error(
      `Unknown inter-module error code "${code}" for method ${methodContract.module}.${methodContract.method}`,
    );
  }

  const parsedDetails: unknown = schema.parse(details);
  // Re-validating a known error (`isInterModuleKnownError`) re-parses
  // `error.details`, already this schema's *output*, through the same
  // schema. A shape-changing `.transform()`/`.pipe()` would then silently
  // fail that later re-validation. Catch the contract violation loudly here,
  // at the point of minting, instead of leaving it as a silent, documented-
  // only constraint that only surfaces as a mysteriously opaque error much
  // later.
  let roundTrips: boolean;
  try {
    roundTrips = schema.safeParse(parsedDetails).success;
  } catch {
    roundTrips = false;
  }
  if (!roundTrips) {
    throw new Error(
      `Error-detail schema for ${methodContract.module}.${methodContract.method} code "${code}" does not keep its input and output shapes identical (no shape-changing transform/pipe is allowed on a known-error schema)`,
    );
  }

  const error = new Error(
    `${methodContract.module}.${methodContract.method}: ${code}`,
  ) as MarkedError;
  error.name = 'InterModuleKnownError';
  error.module = methodContract.module;
  error.method = methodContract.method;
  error.code = code;
  error.details = parsedDetails;
  Object.defineProperty(error, KNOWN_ERROR_MARKER, {value: true, enumerable: false});
  return error as InterModuleKnownError<Code, z.output<Method['errors'][Code]>>;
}

/**
 * Narrows `error` to the discriminated known-error union declared by
 * `methodContract`. Re-checks the marker, the module/method identity, and the
 * code's own details schema instead of trusting `instanceof`, so a forged or
 * cross-method error never narrows.
 *
 * Re-validation re-parses `error.details`, already the code's schema
 * *output*, through that same schema. An error-detail schema must therefore
 * keep its input and output shapes identical (the common case for a plain
 * `z.object({...})`); a shape-changing `.transform()`/`.pipe()` makes a
 * legitimately minted known error fail this re-validation and downgrades it to
 * an opaque failure.
 */
export function isInterModuleKnownError<Method extends InterModuleMethodContract>(
  methodContract: Method,
  error: unknown,
): error is InterModuleKnownErrorFor<Method> {
  try {
    if (!hasKnownErrorMarker(error)) return false;
    if (error.module !== methodContract.module || error.method !== methodContract.method)
      return false;

    const schema = (methodContract.errors as InterModuleErrorSchemas)[error.code];
    if (!schema) return false;

    return schema.safeParse(error.details).success;
  } catch {
    // A schema that behaves asynchronously makes `safeParse` throw instead of
    // returning `{success: false}` (Zod requires `parseAsync` for those). A
    // forged or malformed error must never crash this check: treat any
    // unexpected throw the same as a failed match.
    return false;
  }
}
