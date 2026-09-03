import {z} from 'zod';

export const harnessSchema = z.enum(['pi', 'claude']).meta({
  description:
    'Agent harness. When omitted, Shipfox uses the workspace default harness, or `pi` when none is configured.',
});
export type Harness = z.infer<typeof harnessSchema>;
export const DEFAULT_HARNESS = 'pi' as const satisfies Harness;

export const agentToolSurfaceSchema = z.enum(['strict-direct', 'discovery']).meta({
  description:
    'Integration tool surface for an agent step. Strict direct tools are the default; discovery retains the generic mcp proxy.',
});
export type AgentToolSurface = z.infer<typeof agentToolSurfaceSchema>;

export const piAgentThinkingSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
export const claudeAgentThinkingSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export const agentThinkingSchema = z
  .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  .meta({
    description:
      'Reasoning effort for an agent step. Supported values depend on the resolved harness. When omitted, Shipfox uses the provider default, or `xhigh` when none is configured.',
  });

export type AgentThinking = z.infer<typeof agentThinkingSchema>;

export const DEFAULT_AGENT_THINKING = 'xhigh' as const satisfies AgentThinking;

export const agentThinkingByHarness = {
  pi: piAgentThinkingSchema,
  claude: claudeAgentThinkingSchema,
} as const satisfies Record<
  Harness,
  typeof piAgentThinkingSchema | typeof claudeAgentThinkingSchema
>;

export function thinkingLevelsForHarness(harness: Harness): readonly AgentThinking[] {
  return agentThinkingByHarness[harness].options;
}

// Used by later resolution layers when no workspace or instance provider is configured.
export const DEFAULT_MODEL_PROVIDER = 'anthropic' as const;
