/**
 * Rejects a call whose raw or parsed input failed contract validation. Carries
 * no `cause` and no issue detail on purpose: the transport never attaches a
 * schema's internal error object to a value crossing back to the caller.
 */
export class InterModuleValidationError extends Error {
  readonly module: string;
  readonly method: string;

  constructor(module: string, method: string) {
    super(`Invalid input for inter-module call ${module}.${method}`);
    this.name = 'InterModuleValidationError';
    this.module = module;
    this.method = method;
  }
}

/**
 * Rejects a call that failed for a reason the caller must never see: a bad
 * handler output, a malformed known-error attempt, an undeclared handler
 * exception, or a serialization defect. Carries no `cause`: diagnosis lives in
 * `reportInternalError` and traces, never in the value returned to the caller.
 */
export class InterModuleOpaqueError extends Error {
  readonly module: string;
  readonly method: string;

  constructor(module: string, method: string) {
    super(`Inter-module call ${module}.${method} failed`);
    this.name = 'InterModuleOpaqueError';
    this.module = module;
    this.method = method;
  }
}

/**
 * Rejects a call made against a transport that has not sealed yet, or made
 * after `seal()` (`createClient`/`register`/`seal` all reject once sealed).
 */
export class InterModuleTransportStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InterModuleTransportStateError';
  }
}

/**
 * Thrown by `createClient`/`register` the moment they would introduce a
 * duplicate or mismatched-contract-object presentation, and by `seal()` when
 * a client's module has no registered presentation at all. The transport
 * remains in the building state and the rejected call never mutates it, so
 * the caller can fix the graph and try again.
 */
export class InterModuleCompositionError extends Error {
  readonly issues: readonly string[];

  constructor(issues: string[]) {
    super(
      `Inter-module transport composition failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'InterModuleCompositionError';
    this.issues = issues;
  }
}
