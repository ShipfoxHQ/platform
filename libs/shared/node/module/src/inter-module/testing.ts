import type {
  InterModuleClient,
  InterModuleContractDefinition,
  InterModulePresentation,
} from '@shipfox/inter-module';
import {
  type CreateInMemoryInterModuleTransportOptions,
  createInMemoryInterModuleTransport,
} from './transport.js';

export type FakeInterModulePresentations = Record<string, InterModulePresentation>;

export type FakeInterModuleClients<Presentations extends FakeInterModulePresentations> = {
  [Name in keyof Presentations]: Presentations[Name] extends InterModulePresentation<infer Def>
    ? InterModuleClient<Def extends InterModuleContractDefinition ? Def : never>
    : never;
};

/**
 * Builds one real, fully validated client per named fake presentation, backed by
 * an isolated in-memory transport created and sealed for this call alone. Not
 * coupled to Vitest or any other test framework: any test runner can call this
 * to exercise a caller against a fake producer without the transport's
 * composition ceremony (`createClient` → `register` → `seal`).
 *
 * Each presentation is one built with `defineInterModulePresentation`, exactly
 * as a production module would build it: that keeps each entry's contract and
 * handlers inferred together, so a fake still gets full type checking.
 *
 * Each test that calls this gets its own transport instance; nothing here is
 * process-global, so tests never leak fakes into one another.
 */
export function createFakeInterModuleClients<Presentations extends FakeInterModulePresentations>(
  presentations: Presentations,
  options: CreateInMemoryInterModuleTransportOptions = {},
): FakeInterModuleClients<Presentations> {
  const transport = createInMemoryInterModuleTransport(options);
  const clients = {} as Record<string, unknown>;

  for (const [name, presentation] of Object.entries(presentations)) {
    clients[name] = transport.createClient(presentation.contract);
  }
  for (const presentation of Object.values(presentations)) {
    transport.register(presentation);
  }
  transport.seal();

  return clients as FakeInterModuleClients<Presentations>;
}
