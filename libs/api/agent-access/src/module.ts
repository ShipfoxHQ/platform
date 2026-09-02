import type {ShipfoxModule} from '@shipfox/node-module';
import {
  type CreateAgentAccessRoutesOptions,
  createAgentAccessRoutes,
} from '#presentation/routes.js';

export type CreateAgentAccessModuleOptions = CreateAgentAccessRoutesOptions;

/** Creates the opt-in agent-access module; composition intentionally owns activation. */
export function createAgentAccessModule(
  options: CreateAgentAccessModuleOptions = {},
): ShipfoxModule {
  return {
    name: 'agent-access',
    routes: [createAgentAccessRoutes(options)],
  };
}

export const agentAccessModule = createAgentAccessModule();
