import type {AgentModel, HarnessDescriptor, HarnessId, ProviderConfig} from './models.js';

export const DEFAULT_HARNESS: HarnessId = 'pi';

const harnesses: readonly HarnessDescriptor[] = [
  {
    id: 'pi',
    label: 'pi',
    description: 'Works with 30+ model providers',
    supportedProviderIds: [
      'anthropic',
      'ant-ling',
      'azure-openai-responses',
      'openai',
      'deepseek',
      'nvidia',
      'google',
      'mistral',
      'groq',
      'cerebras',
      'cloudflare-ai-gateway',
      'cloudflare-workers-ai',
      'xai',
      'openrouter',
      'vercel-ai-gateway',
      'zai',
      'zai-coding-cn',
      'opencode',
      'opencode-go',
      'huggingface',
      'fireworks',
      'together',
      'kimi-coding',
      'qwen-token-plan',
      'qwen-token-plan-cn',
      'minimax',
      'minimax-cn',
      'moonshotai',
      'moonshotai-cn',
      'xiaomi',
      'xiaomi-token-plan-cn',
      'xiaomi-token-plan-ams',
      'xiaomi-token-plan-sgp',
    ],
  },
  {
    id: 'claude',
    label: 'Claude',
    description: 'Runs on your Anthropic API key',
    supportedProviderIds: ['anthropic'],
  },
];

export function listHarnesses(): readonly HarnessDescriptor[] {
  return harnesses;
}

export function getHarness(id: HarnessId): HarnessDescriptor {
  const harness = harnesses.find((item) => item.id === id);
  if (harness === undefined) throw new Error(`Unknown harness: ${id}`);
  return harness;
}

export function harnessSupportsProvider(harnessId: HarnessId, providerId: string): boolean {
  return getHarness(harnessId).supportedProviderIds.includes(providerId);
}

export function configSupportsHarness(config: ProviderConfig, harness: HarnessDescriptor): boolean {
  return config.kind === 'custom'
    ? harness.id === DEFAULT_HARNESS
    : harness.supportedProviderIds.includes(config.providerId);
}

export function managedModelSupportsHarness(
  harnessId: HarnessId,
  model: Pick<AgentModel, 'api'>,
): boolean {
  return harnessId === 'pi' || model.api === undefined || model.api === 'anthropic-messages';
}

export function compatibleHarnessIds({
  isCustom,
  isManaged = false,
  models,
  providerId,
}: {
  isCustom: boolean;
  isManaged?: boolean;
  models?: readonly Pick<AgentModel, 'api'>[];
  providerId: string;
}): HarnessId[] {
  if (isCustom) return [DEFAULT_HARNESS];
  if (isManaged) {
    return harnesses
      .filter(
        (harness) =>
          models === undefined ||
          models.some((model) => managedModelSupportsHarness(harness.id, model)),
      )
      .map((harness) => harness.id);
  }
  return harnesses
    .filter((harness) => harness.supportedProviderIds.includes(providerId))
    .map((harness) => harness.id);
}
