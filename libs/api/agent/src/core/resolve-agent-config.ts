import {
  type AgentThinking,
  agentThinkingByHarness,
  type CustomAgentModelDto,
  DEFAULT_HARNESS,
  getHarnessDescriptor,
  type Harness,
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
  readonly instanceDefaultProvider?: SupportedModelProviderId | undefined;
  readonly instanceDefaultModel?: string | undefined;
  readonly instanceDefaultThinking?: AgentThinking | undefined;
}

interface WorkspaceProviderDefaults {
  readonly kind?: 'builtin' | 'custom' | undefined;
  readonly defaultModel: string | null;
  readonly defaultThinking: AgentThinking;
  readonly models?: readonly CustomAgentModelDto[] | null | undefined;
}

type ModelCandidateResolver = () => string | null | undefined;

export function resolveAgentConfig(
  step: ContextualAgentConfig,
  ctx: AgentConfigResolutionContext = {},
): ResolvedAgentConfig {
  const harness = step.harness ?? ctx.workspaceDefaultHarnessId ?? DEFAULT_HARNESS;
  const provider = resolveProvider(step, ctx, harness);
  const workspaceProviderConfig = ctx.workspaceProviderConfigs?.get(provider);
  const model = resolveModel({
    step,
    ctx,
    harness,
    provider,
    workspaceProviderConfig,
  });
  const thinking = resolveThinking({step, ctx, harness, provider, workspaceProviderConfig});

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
    if (!isHarnessCompatible(harness, provider, ctx.workspaceProviderConfigs?.get(provider))) {
      throw new UnsupportedHarnessProviderError(
        harness,
        step.provider,
        descriptor.supportedProviderIds,
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

    const workspaceProviderConfig = ctx.workspaceProviderConfigs?.get(candidate);
    if (!isHarnessCompatible(harness, candidate, workspaceProviderConfig)) continue;

    return resolveSupportedProvider(candidate, ctx);
  }

  return descriptor.defaultProviderId;
}

function resolveSupportedProvider(
  provider: string,
  ctx: AgentConfigResolutionContext,
): ModelProviderRef {
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
  workspaceProviderConfig: WorkspaceProviderDefaults | undefined;
}): string {
  if (params.step.model !== undefined) {
    validateModel(
      params.harness,
      params.provider,
      params.step.model,
      params.workspaceProviderConfig,
    );
    return params.step.model;
  }

  const candidates: ModelCandidateResolver[] = [() => params.workspaceProviderConfig?.defaultModel];
  if (params.workspaceProviderConfig?.kind === 'custom') {
    candidates.push(() => customDefaultModel(params.workspaceProviderConfig));
  } else {
    candidates.push(
      () => instanceDefaultModel(params.provider, params.ctx),
      () => catalogDefaultModel(params.harness, params.provider),
    );
  }

  for (const resolveCandidate of candidates) {
    const candidate = resolveCandidate();
    if (candidate === undefined || candidate === null) continue;
    if (
      modelIsAvailable(params.harness, params.provider, candidate, params.workspaceProviderConfig)
    ) {
      return candidate;
    }
  }

  throw new InvalidAgentModelError(params.harness, params.provider, '');
}

function catalogDefaultModel(harness: Harness, provider: ModelProviderRef): string {
  const catalogModels = listProviderModels(harness, provider);
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

function customDefaultModel(
  workspaceProviderConfig: WorkspaceProviderDefaults | undefined,
): string | undefined {
  if (workspaceProviderConfig?.kind !== 'custom') return undefined;
  return workspaceProviderConfig.models?.[0]?.id;
}

function validateModel(
  harness: Harness,
  provider: ModelProviderRef,
  model: string,
  workspaceProviderConfig: WorkspaceProviderDefaults | undefined,
): void {
  if (modelIsAvailable(harness, provider, model, workspaceProviderConfig)) return;
  throw new InvalidAgentModelError(harness, provider, model);
}

function modelIsAvailable(
  harness: Harness,
  provider: ModelProviderRef,
  model: string,
  workspaceProviderConfig: WorkspaceProviderDefaults | undefined,
): boolean {
  if (workspaceProviderConfig?.kind === 'custom') {
    return workspaceProviderConfig.models?.some((candidate) => candidate.id === model) ?? false;
  }

  return listProviderModels(harness, provider).some((candidate) => candidate.id === model);
}

function listProviderModels(harness: Harness, provider: ModelProviderRef): readonly {id: string}[] {
  return listHarnessProviderModels(harness, provider);
}

function isHarnessCompatible(
  harness: Harness,
  provider: ModelProviderRef,
  workspaceProviderConfig: WorkspaceProviderDefaults | undefined,
): boolean {
  if (workspaceProviderConfig?.kind === 'custom') return harness === 'pi';

  return getHarnessDescriptor(harness).supportedProviderIds.includes(provider);
}

function resolveThinking(params: {
  step: ContextualAgentConfig;
  ctx: AgentConfigResolutionContext;
  harness: Harness;
  provider: ModelProviderRef;
  workspaceProviderConfig: WorkspaceProviderDefaults | undefined;
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

  const candidates = [
    params.workspaceProviderConfig?.defaultThinking,
    instanceDefaultThinking(params.provider, params.ctx),
    descriptor.defaultThinking,
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && thinkingSchema.safeParse(candidate).success) return candidate;
  }

  return descriptor.defaultThinking;
}
