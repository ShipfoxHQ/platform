import type {ModelProviderRef} from '@shipfox/api-agent-dto';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {AgentThinking, Harness} from '@shipfox/workflow-document';

export interface AgentDefaultsInput {
  readonly harness?: Harness | undefined;
  readonly provider?: ModelProviderRef | undefined;
  readonly model?: string | undefined;
  /** A resolved template can carry any string. The agent module validates it. */
  readonly thinking?: string | undefined;
}

export interface ResolvedAgentDefaults {
  readonly harness: Harness;
  readonly provider: ModelProviderRef;
  readonly model: string;
  readonly thinking: AgentThinking;
}

export type AgentDefaultsResolver = (
  input: AgentDefaultsInput,
) => ResolvedAgentDefaults | Promise<ResolvedAgentDefaults>;

export function createAgentDefaultsResolver(
  agent: AgentInterModuleClient,
  workspaceId: string | null,
): AgentDefaultsResolver {
  return async (config) =>
    await agent.resolveAgentConfig({
      workspaceId,
      config: {
        ...(config.harness === undefined ? {} : {harness: config.harness}),
        ...(config.provider === undefined ? {} : {provider: config.provider}),
        ...(config.model === undefined ? {} : {model: config.model}),
        ...(config.thinking === undefined ? {} : {thinking: config.thinking}),
      },
    });
}
