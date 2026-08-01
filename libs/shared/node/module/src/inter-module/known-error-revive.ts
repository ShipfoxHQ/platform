import {
  createInterModuleKnownError,
  hasInterModuleKnownErrorMarker,
  type InterModuleKnownError,
  type InterModuleMethodContract,
  isInterModuleKnownError,
} from '@shipfox/inter-module';
import {isJsonSafeValue} from './json.js';

export type KnownErrorRevival =
  | {outcome: 'known-error'; error: InterModuleKnownError}
  | {outcome: 'known-error-contract-defect'}
  | {outcome: 'undeclared'};

/**
 * Classifies a value a handler threw, then mints a fresh, JSON-copied known
 * error rather than trusting the handler's own error instance. A thrown value
 * with no marker at all is `undeclared` (an ordinary handler bug); one with the
 * marker that fails re-validation (forged code, invalid or non-JSON-safe
 * details) is a `known-error-contract-defect`: a producer bug, not a caller-
 * visible known error.
 */
export function reviveThrownKnownError(
  methodContract: InterModuleMethodContract,
  thrown: unknown,
): KnownErrorRevival {
  if (!hasInterModuleKnownErrorMarker(thrown)) return {outcome: 'undeclared'};

  try {
    if (!isInterModuleKnownError(methodContract, thrown)) {
      return {outcome: 'known-error-contract-defect'};
    }

    if (!isJsonSafeValue(thrown.details)) {
      return {outcome: 'known-error-contract-defect'};
    }

    const copiedDetails: unknown = JSON.parse(JSON.stringify(thrown.details));
    const fresh = createInterModuleKnownError(methodContract, thrown.code, copiedDetails);
    return {outcome: 'known-error', error: fresh};
  } catch {
    // A marked-but-hostile value (a throwing accessor, a schema that behaves
    // asynchronously) must classify as a contract defect, never escape as a
    // raw exception.
    return {outcome: 'known-error-contract-defect'};
  }
}
