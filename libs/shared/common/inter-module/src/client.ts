import type {z} from 'zod';
import type {InterModuleContract, InterModuleContractDefinition} from './contract.js';

/**
 * Transport options for one call. Never a business field: a producer schema must
 * not declare a `signal`-shaped input, and a transport must not fold this into
 * the JSON payload it validates or copies.
 */
export interface InterModuleCallOptions {
  signal?: AbortSignal;
}

export interface InterModuleDispatchCall {
  readonly module: string;
  readonly method: string;
  readonly input: unknown;
  readonly options?: InterModuleCallOptions | undefined;
}

/**
 * The seam a transport author implements. Given a call description, it resolves
 * with the method's output or rejects with a known error, a validation
 * rejection, an opaque failure, or the call's `AbortSignal` reason.
 */
export type InterModuleDispatch = (call: InterModuleDispatchCall) => Promise<unknown>;

export type InterModuleClient<Def extends InterModuleContractDefinition> = {
  [Method in keyof Def['methods'] & string]: (
    input: z.input<Def['methods'][Method]['input']>,
    options?: InterModuleCallOptions,
  ) => Promise<z.output<Def['methods'][Method]['output']>>;
};

/**
 * Builds a typed client over `dispatch`. This is the only seam a transport author
 * needs to implement. The in-memory transport, a fake test presentation, and
 * any future network transport all produce a client this same way.
 */
export function createInterModuleClient<Def extends InterModuleContractDefinition>(
  contract: InterModuleContract<Def>,
  dispatch: InterModuleDispatch,
): InterModuleClient<Def> {
  const client = {} as Record<string, unknown>;
  for (const method of Object.keys(contract.methods)) {
    client[method] = (input: unknown, options?: InterModuleCallOptions) =>
      dispatch({module: contract.module, method, input, options});
  }
  return client as InterModuleClient<Def>;
}
