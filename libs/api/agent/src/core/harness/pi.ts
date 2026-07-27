import {getModels} from '@earendil-works/pi-ai/compat';
import {type AgentModelOptionDto, PI_HARNESS} from '@shipfox/api-agent-dto';
import {probeModelProviderCredentials} from '../model-provider-validation.js';
import type {HarnessProviderCatalog} from './registry.js';

export {PI_HARNESS};

export function listPiProviderModels(providerId: string): AgentModelOptionDto[] {
  return getModels(providerId as Parameters<typeof getModels>[0]).map((model) => ({
    id: model.id,
    label: model.name,
  }));
}

export const piHarnessCatalog: HarnessProviderCatalog = {
  listModels: listPiProviderModels,
  validateCredentials: probeModelProviderCredentials,
};
