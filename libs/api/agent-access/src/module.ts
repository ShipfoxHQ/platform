import type {ShipfoxModule} from '@shipfox/node-module';
import {
  type CreateAgentAccessRoutesOptions,
  createAgentAccessRoutes,
} from '#presentation/routes.js';

export type CreateAgentAccessModuleOptions = CreateAgentAccessRoutesOptions;

/** Creates the agent-access module; default composition supplies producer clients. */
export function createAgentAccessModule(
  options: CreateAgentAccessModuleOptions = {},
): ShipfoxModule {
  return {
    name: 'agent-access',
    routes: [createAgentAccessRoutes(options)],
  };
}

export const agentAccessModule = createAgentAccessModule();
