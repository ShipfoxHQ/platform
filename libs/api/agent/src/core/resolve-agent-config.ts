import {
  type AgentThinking,
  agentThinkingByHarness,
  type CustomAgentModelDto,
  DEFAULT_HARNESS,
  getHarnessDescriptor,
  type Harness,
  type ManagedModelEntry,
  type ManagedModelProvider,
  type ModelProviderRef,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {
  InvalidAgentModelError,
  UnsupportedHarnessProviderError,
  UnsupportedHarnessThinkingError,
  UnsupportedModelProviderError,
} from './errors.js';
import {listHarnessProviderModels} from './harness/index.js';
import {getModelProviderEntry} from './model-provider-policy.js';

export interface ContextualAgentConfig {
  readonly harness?: Harness | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  /** A resolved template can carry any string. `resolveThinking` validates it. */
  readonly thinking?: string | undefined;
}

export interface ResolvedAgentConfig {
  readonly harness: Harness;
  readonly provider: ModelProviderRef;
  readonly model: string;
  readonly thinking: AgentThinking;
}

export type AgentDefaultsResolver = (step: ContextualAgentConfig) => ResolvedAgentConfig;

export interface AgentConfigResolutionContext {
  readonly workspaceDefaultHarnessId?: Harness | null | undefined;
  readonly workspaceDefaultProviderId?: ModelProviderRef | null | undefined;
  readonly workspaceProviderConfigs?: ReadonlyMap<ModelProviderRef, WorkspaceProviderDefaults>;
  readonly instanceDefaultProvider?: ModelProviderRef | undefined;
  readonly instanceDefaultModel?: string | undefined;
  readonly instanceDefaultThinking?: AgentThinking | undefined;
  readonly managedProvider?: ManagedModelProvider | undefined;
}

interface WorkspaceProviderDefaults {
  readonly kind?: 'builtin' | 'custom' | undefined;
  readonly defaultModel: string | null;
  readonly defaultThinking: AgentThinking;
  readonly models?: readonly CustomAgentModelDto[] | null | undefined;
}

interface ManagedProviderDefaults {
  readonly kind: 'managed';
  readonly defaultModel: string;
  readonly defaultThinking?: AgentThinking | undefined;
  readonly models: readonly ManagedModelEntry[];
}

type ProviderDefaults = WorkspaceProviderDefaults | ManagedProviderDefaults;

type ModelCandidateResolver = () => string | null | undefined;

export function resolveAgentConfig(
  step: ContextualAgentConfig,
  ctx: AgentConfigResolutionContext = {},
): ResolvedAgentConfig {
  const harness = step.harness ?? ctx.workspaceDefaultHarnessId ?? DEFAULT_HARNESS;
  const provider = resolveProvider(step, ctx, harness);
  const providerConfig = getProviderConfig(provider, ctx);
  const model = resolveModel({
    step,
    ctx,
    harness,
    provider,
    providerConfig,
  });
  const thinking = resolveThinking({step, ctx, harness, provider, providerConfig});

  return {harness, provider, model, thinking};
}

export const catalogDefaultAgentResolver: AgentDefaultsResolver = (step) =>
  resolveAgentConfig(step);

function resolveProvider(
  step: ContextualAgentConfig,
  ctx: AgentConfigResolutionContext,
  harness: Harness,
): ModelProviderRef {
  const descriptor = getHarnessDescriptor(harness);
  if (step.provider !== undefined) {
    const provider = resolveSupportedProvider(step.provider, ctx);
    if (!isHarnessCompatible(harness, provider, getProviderConfig(provider, ctx))) {
      throw new UnsupportedHarnessProviderError(
        harness,
        step.provider,
        supportedProviderIds(harness, descriptor, ctx),
      );
    }
    return provider;
  }

  const candidates = [
    ctx.workspaceDefaultProviderId,
    ctx.instanceDefaultProvider,
    descriptor.defaultProviderId,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;

    const providerConfig = getProviderConfig(candidate, ctx);
    if (!isHarnessCompatible(harness, candidate, providerConfig)) continue;

    return resolveSupportedProvider(candidate, ctx);
  }

  return descriptor.defaultProviderId;
}

function resolveSupportedProvider(
  provider: string,
  ctx: AgentConfigResolutionContext,
): ModelProviderRef {
  if (ctx.managedProvider?.id === provider) return provider as ModelProviderRef;

  const workspaceProviderConfig = ctx.workspaceProviderConfigs?.get(provider);
  if (workspaceProviderConfig?.kind === 'custom') return provider;

  const entry = getModelProviderEntry(provider);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(provider);
  }
  return provider as SupportedModelProviderId;
}

function resolveModel(params: {
  step: ContextualAgentConfig;
  ctx: AgentConfigResolutionContext;
  harness: Harness;
  provider: ModelProviderRef;
  providerConfig: ProviderDefaults | undefined;
}): string {
  const providerConfig = params.providerConfig;

  if (params.step.model !== undefined) {
    validateModel(params.harness, params.provider, params.step.model, params.providerConfig);
    return params.step.model;
  }

  const candidates: ModelCandidateResolver[] = [];
  if (providerConfig?.kind === 'custom') {
    candidates.push(
      () => providerConfig.defaultModel,
      () => customDefaultModel(providerConfig),
    );
  } else if (providerConfig?.kind === 'managed') {
    candidates.push(
      () => instanceDefaultModel(params.provider, params.ctx),
      () => providerConfig.defaultModel,
      () => managedDefaultModel(params.harness, params.provider, providerConfig),
    );
  } else {
    candidates.push(
      () => providerConfig?.defaultModel,
      () => instanceDefaultModel(params.provider, params.ctx),
      () => catalogDefaultModel(params.harness, params.provider),
    );
  }

  for (const resolveCandidate of candidates) {
    const candidate = resolveCandidate();
    if (candidate === undefined || candidate === null) continue;
    if (modelIsAvailable(params.harness, params.provider, candidate, params.providerConfig)) {
      return candidate;
    }
  }

  throw new InvalidAgentModelError(params.harness, params.provider, '');
}

function catalogDefaultModel(harness: Harness, provider: ModelProviderRef): string {
  const catalogModels = listProviderModels(harness, provider, undefined);
  const entry = getModelProviderEntry(provider);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(provider);
  }
  if (
    entry.default_model !== null &&
    catalogModels.some((candidate) => candidate.id === entry.default_model)
  ) {
    return entry.default_model;
  }

  const firstModel = catalogModels[0];
  if (firstModel === undefined) throw new InvalidAgentModelError(harness, provider, '');
  return firstModel.id;
}

function instanceDefaultModel(
  provider: ModelProviderRef,
  ctx: AgentConfigResolutionContext,
): string | undefined {
  return provider === ctx.instanceDefaultProvider ? ctx.instanceDefaultModel : undefined;
}

function instanceDefaultThinking(
  provider: ModelProviderRef,
  ctx: AgentConfigResolutionContext,
): AgentThinking | undefined {
  return provider === ctx.instanceDefaultProvider ? ctx.instanceDefaultThinking : undefined;
}

function customDefaultModel(providerConfig: ProviderDefaults | undefined): string | undefined {
  if (providerConfig?.kind !== 'custom') return undefined;
  return providerConfig.models?.[0]?.id;
}

function managedDefaultModel(
  harness: Harness,
  provider: ModelProviderRef,
  providerConfig: ManagedProviderDefaults,
): string {
  const model = listManagedProviderModels(harness, providerConfig)[0];
  if (model === undefined) throw new InvalidAgentModelError(harness, provider, '');
  return model.id;
}

function validateModel(
  harness: Harness,
  provider: ModelProviderRef,
  model: string,
  providerConfig: ProviderDefaults | undefined,
): void {
  if (modelIsAvailable(harness, provider, model, providerConfig)) return;
  throw new InvalidAgentModelError(harness, provider, model);
}

function modelIsAvailable(
  harness: Harness,
  provider: ModelProviderRef,
  model: string,
  providerConfig: ProviderDefaults | undefined,
): boolean {
  if (providerConfig?.kind === 'custom') {
    return providerConfig.models?.some((candidate) => candidate.id === model) ?? false;
  }

  return listProviderModels(harness, provider, providerConfig).some(
    (candidate) => candidate.id === model,
  );
}

function listProviderModels(
  harness: Harness,
  provider: ModelProviderRef,
  providerConfig: ProviderDefaults | undefined,
): readonly {id: string}[] {
  if (providerConfig?.kind === 'managed') {
    return listManagedProviderModels(harness, providerConfig);
  }
  return listHarnessProviderModels(harness, provider);
}

function isHarnessCompatible(
  harness: Harness,
  provider: ModelProviderRef,
  providerConfig: ProviderDefaults | undefined,
): boolean {
  if (providerConfig?.kind === 'custom') return harness === 'pi';
  if (providerConfig?.kind === 'managed') {
    return listManagedProviderModels(harness, providerConfig).length > 0;
  }

  return getHarnessDescriptor(harness).supportedProviderIds.includes(provider);
}

function resolveThinking(params: {
  step: ContextualAgentConfig;
  ctx: AgentConfigResolutionContext;
  harness: Harness;
  provider: ModelProviderRef;
  providerConfig: ProviderDefaults | undefined;
}): AgentThinking {
  const thinkingSchema = agentThinkingByHarness[params.harness];
  const descriptor = getHarnessDescriptor(params.harness);

  if (params.step.thinking !== undefined) {
    const parsed = thinkingSchema.safeParse(params.step.thinking);
    if (!parsed.success) {
      throw new UnsupportedHarnessThinkingError(
        params.harness,
        params.step.thinking,
        descriptor.thinkingLevels,
      );
    }
    return parsed.data;
  }

  const candidates =
    params.providerConfig?.kind === 'managed'
      ? [
          instanceDefaultThinking(params.provider, params.ctx),
          params.providerConfig.defaultThinking,
          descriptor.defaultThinking,
        ]
      : [
          params.providerConfig?.defaultThinking,
          instanceDefaultThinking(params.provider, params.ctx),
          descriptor.defaultThinking,
        ];
  for (const candidate of candidates) {
    if (candidate !== undefined && thinkingSchema.safeParse(candidate).success) return candidate;
  }

  return descriptor.defaultThinking;
}

function getProviderConfig(
  provider: ModelProviderRef,
  ctx: AgentConfigResolutionContext,
): ProviderDefaults | undefined {
  if (ctx.managedProvider?.id === provider) {
    return {
      kind: 'managed',
      defaultModel: ctx.managedProvider.defaultModel,
      defaultThinking: ctx.managedProvider.defaultThinking,
      models: ctx.managedProvider.models,
    };
  }

  return ctx.workspaceProviderConfigs?.get(provider);
}

function listManagedProviderModels(
  harness: Harness,
  providerConfig: ManagedProviderDefaults,
): readonly ManagedModelEntry[] {
  return providerConfig.models.filter((model) => managedModelSupportsHarness(harness, model));
}

function managedModelSupportsHarness(harness: Harness, model: ManagedModelEntry): boolean {
  return harness === 'pi' || model.api === 'anthropic-messages';
}

function supportedProviderIds(
  harness: Harness,
  descriptor: ReturnType<typeof getHarnessDescriptor>,
  ctx: AgentConfigResolutionContext,
): readonly string[] {
  if (
    ctx.managedProvider === undefined ||
    !ctx.managedProvider.models.some((model) => managedModelSupportsHarness(harness, model))
  ) {
    return descriptor.supportedProviderIds;
  }

  return [...descriptor.supportedProviderIds, ctx.managedProvider.id];
}
