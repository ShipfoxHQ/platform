import {
  createInterModuleClient,
  type InterModuleClient,
  type InterModuleContract,
  type InterModuleContractDefinition,
  type InterModuleMethodContract,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import type {trace} from '@shipfox/node-opentelemetry';
import {
  type InterModuleHandlerFn,
  type InterModuleReportInternalError,
  runInterModuleCall,
} from './dispatch.js';
import {InterModuleCompositionError, InterModuleTransportStateError} from './errors.js';
import {resolveInterModuleTracer} from './tracing.js';

const TRANSPORT_NAME = 'in-memory';

export interface CreateInMemoryInterModuleTransportOptions {
  tracer?: ReturnType<typeof trace.getTracer>;
  reportInternalError?: InterModuleReportInternalError;
}

/**
 * Composition lifecycle:
 *
 * ```text
 * BUILDING
 *   ├─ createClient(contract) ── duplicate/mismatch ── reject; remain BUILDING
 *   │                       └── otherwise ──────────── records required contract
 *   ├─ register(presentation) ── duplicate/mismatch ── reject; remain BUILDING
 *   │                        └── otherwise ─────────── records contract and handlers
 *   └─ seal()
 *        ├─ a required module has no registered presentation ── reject; remain BUILDING
 *        └─ valid graph ───────────────────────────────────────> SEALED
 *                                                                 ├─ calls allowed
 *                                                                 └─ create/register/reseal reject
 * ```
 *
 * `createClient` and `register` reject a duplicate or mismatched-contract-object
 * call immediately, without mutating any state: the rejected call itself never
 * corrupts the graph, so fixing the caller's code and retrying that same call is
 * always enough to recover. `seal()` only has to catch what neither of those can
 * know in advance: a client whose module never got a presentation registered.
 *
 * Clients may be created before presentations so two modules can call each
 * other without a code import cycle. A client and its presentation must
 * reference the exact same contract object `defineInterModuleContract`
 * returned: matching module/method name strings alone is not enough.
 */
export interface InterModuleTransport {
  createClient<Def extends InterModuleContractDefinition>(
    contract: InterModuleContract<Def>,
  ): InterModuleClient<Def>;
  register<Def extends InterModuleContractDefinition>(
    presentation: InterModulePresentation<Def>,
  ): void;
  seal(): void;
}

interface RegisteredPresentation {
  contract: InterModuleContract<InterModuleContractDefinition>;
  handlers: Readonly<Record<string, InterModuleHandlerFn>>;
}

export function createInMemoryInterModuleTransport(
  options: CreateInMemoryInterModuleTransportOptions = {},
): InterModuleTransport {
  const tracer = resolveInterModuleTracer(options.tracer);
  const reportInternalError: InterModuleReportInternalError =
    options.reportInternalError ?? (() => undefined);
  const hasInternalReporter = options.reportInternalError !== undefined;

  let sealed = false;
  const clientContractByModule = new Map<
    string,
    InterModuleContract<InterModuleContractDefinition>
  >();
  const registrationByModule = new Map<string, RegisteredPresentation>();

  function requireBuilding(action: string): void {
    if (sealed) {
      throw new InterModuleTransportStateError(
        `Cannot ${action}: the inter-module transport is already sealed`,
      );
    }
  }

  function createClient<Def extends InterModuleContractDefinition>(
    contract: InterModuleContract<Def>,
  ): InterModuleClient<Def> {
    requireBuilding('create a client');

    const erasedContract = contract as InterModuleContract<InterModuleContractDefinition>;
    // Checked and rejected here, before anything is recorded, so a mismatched
    // call never corrupts the graph: fixing the caller's code and retrying is
    // always enough, unlike a check deferred to seal() after the graph has
    // already accumulated the bad entry.
    const existingRequirement = clientContractByModule.get(contract.module);
    if (existingRequirement && existingRequirement !== erasedContract) {
      throw new InterModuleCompositionError([
        `Module "${contract.module}" was requested with mismatched contract objects`,
      ]);
    }
    const registration = registrationByModule.get(contract.module);
    if (registration && registration.contract !== erasedContract) {
      throw new InterModuleCompositionError([
        `Module "${contract.module}" presentation contract does not match the contract used by its client`,
      ]);
    }

    clientContractByModule.set(contract.module, erasedContract);

    return createInterModuleClient(contract, (call) => {
      if (!sealed) {
        return Promise.reject(
          new InterModuleTransportStateError(
            `Cannot call ${call.module}.${call.method}: the inter-module transport is not sealed yet`,
          ),
        );
      }

      const registration = registrationByModule.get(call.module);
      const methodContract = registration?.contract.methods[call.method] as
        | InterModuleMethodContract
        | undefined;
      const handler = registration?.handlers[call.method];
      if (!registration || !methodContract || !handler) {
        return Promise.reject(
          new InterModuleTransportStateError(
            `No presentation registered for ${call.module}.${call.method} despite a sealed transport`,
          ),
        );
      }

      return runInterModuleCall({
        module: call.module,
        method: call.method,
        input: call.input,
        options: call.options,
        methodContract,
        handler,
        tracer,
        transportName: TRANSPORT_NAME,
        reportInternalError,
        hasInternalReporter,
      });
    });
  }

  function register<Def extends InterModuleContractDefinition>(
    presentation: InterModulePresentation<Def>,
  ): void {
    requireBuilding('register a presentation');

    const erased = presentation as InterModulePresentation<InterModuleContractDefinition>;
    // Same eager-rejection contract as createClient() above: a duplicate or
    // mismatched registration throws before anything is recorded, so it never
    // leaves the graph in a state only a fresh transport instance could escape.
    if (registrationByModule.has(erased.contract.module)) {
      throw new InterModuleCompositionError([
        `Module "${erased.contract.module}" already has a registered presentation`,
      ]);
    }
    const existingRequirement = clientContractByModule.get(erased.contract.module);
    if (existingRequirement && existingRequirement !== erased.contract) {
      throw new InterModuleCompositionError([
        `Module "${erased.contract.module}" presentation contract does not match the contract used by its client`,
      ]);
    }

    // Snapshot the handlers into a transport-owned, frozen record instead of
    // keeping the caller's own object by reference: mutating the presentation
    // object after seal() must never change what a sealed transport dispatches
    // to. Checking `typeof === 'function'` (not mere truthiness) also catches
    // a non-callable handler value at registration time, not as a confusing
    // TypeError on the first call.
    const handlers: Record<string, InterModuleHandlerFn> = {};
    for (const method of Object.keys(erased.contract.methods)) {
      const handler = erased.handlers[method];
      if (typeof handler !== 'function') {
        throw new InterModuleCompositionError([
          `Presentation for module "${erased.contract.module}" is missing a handler for method "${method}"`,
        ]);
      }
      handlers[method] = handler;
    }

    registrationByModule.set(erased.contract.module, {
      contract: erased.contract,
      handlers: Object.freeze(handlers),
    });
  }

  function seal(): void {
    requireBuilding('seal');

    // createClient()/register() already reject a duplicate or mismatched
    // contract the moment it would occur. The only issue left to detect here is
    // a client requirement whose module never got a presentation.
    const issues: string[] = [];
    for (const moduleName of clientContractByModule.keys()) {
      if (!registrationByModule.has(moduleName)) {
        issues.push(`Module "${moduleName}" has no registered presentation`);
      }
    }

    if (issues.length > 0) {
      throw new InterModuleCompositionError(issues);
    }

    sealed = true;
  }

  return {createClient, register, seal};
}
