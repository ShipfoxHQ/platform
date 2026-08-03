import type {z} from 'zod';
import type {InterModuleContract, InterModuleContractDefinition} from './contract.js';

/**
 * Handed to every handler outside the business input. Handlers that want to
 * cooperate with cancellation read `signal` directly (e.g. pass it to a fetch
 * call); a transport still enforces first-settlement-wins on top of this.
 */
export interface InterModuleHandlerContext {
  signal: AbortSignal;
}

export type InterModuleHandler<
  Def extends InterModuleContractDefinition,
  Method extends keyof Def['methods'] & string,
> = (
  input: z.output<Def['methods'][Method]['input']>,
  context: InterModuleHandlerContext,
) => Promise<z.input<Def['methods'][Method]['output']>> | z.input<Def['methods'][Method]['output']>;

export type InterModulePresentationHandlers<Def extends InterModuleContractDefinition> = {
  [Method in keyof Def['methods'] & string]: InterModuleHandler<Def, Method>;
};

/**
 * Closes a producer's domain code over its own contract. A transport's `register`
 * requires the exact contract object a client was created from: a presentation
 * built against a different (even structurally identical) contract object is a
 * mismatch, not a match, so two contexts can never accidentally cross-wire.
 */
export interface InterModulePresentation<
  Def extends InterModuleContractDefinition = InterModuleContractDefinition,
> {
  readonly contract: InterModuleContract<Def>;
  readonly handlers: InterModulePresentationHandlers<Def>;
}

export function defineInterModulePresentation<Def extends InterModuleContractDefinition>(
  contract: InterModuleContract<Def>,
  handlers: InterModulePresentationHandlers<Def>,
): InterModulePresentation<Def> {
  return {contract, handlers};
}
