import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import type {CustomProviderConfig, SupportedProvider} from '#core/models.js';
import {ModelProviderUsageModal} from './model-provider-usage-modal.js';
import {
  usageTargetFromCatalogEntry,
  usageTargetFromCustomConfig,
} from './model-provider-usage-target.js';

interface ModelProviderUsageModalStoryProps {
  variant: 'anthropic' | 'custom' | 'long-list';
}

function ModelProviderUsageModalStory({variant}: ModelProviderUsageModalStoryProps) {
  const [open, setOpen] = useState(true);
  const entry = variant === 'long-list' ? longListEntry() : anthropicEntry();
  const target =
    variant === 'custom'
      ? usageTargetFromCustomConfig(customProviderConfig())
      : usageTargetFromCatalogEntry(entry);

  return (
    <div className="min-h-screen bg-background-subtle-base p-24">
      <ModelProviderUsageModal
        target={target}
        initialModel={target.defaultModel}
        workspaceDefaultHarnessId="claude"
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

const meta = {
  title: 'Agent/ProviderUsageModal',
  component: ModelProviderUsageModalStory,
  parameters: {layout: 'fullscreen'},
  args: {variant: 'anthropic'},
} satisfies Meta<typeof ModelProviderUsageModalStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const LongModelList: Story = {
  args: {variant: 'long-list'},
};

export const CustomProvider: Story = {
  args: {variant: 'custom'},
};

function anthropicEntry(): SupportedProvider {
  return {
    kind: 'supported',
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-opus-4-8',
    credentialFields: [{key: 'api_key', label: 'API key', secret: true}],
    models: [
      {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
      {id: 'claude-sonnet-4-8', label: 'Claude Sonnet 4.8'},
      {id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5'},
    ],
  };
}

function longListEntry(): SupportedProvider {
  return {
    kind: 'supported',
    id: 'cloudflare-workers-ai',
    label: 'Cloudflare Workers AI',
    defaultModel: '@cf/moonshotai/kimi-k2.7-code',
    credentialFields: [{key: 'api_token', label: 'API token', secret: true}],
    models: Array.from({length: 56}, (_, index) => ({
      id:
        index === 0
          ? '@cf/moonshotai/kimi-k2.7-code'
          : `provider/research-lab/model-family-${String(index).padStart(2, '0')}-large-context`,
      label: index === 0 ? 'Kimi K2.7 Code' : `Research Model ${index}`,
    })),
  };
}

function customProviderConfig(): CustomProviderConfig {
  return {
    kind: 'custom',
    providerId: 'local-vllm',
    displayName: 'Local vLLM',
    api: 'openai-completions',
    baseUrl: 'http://localhost:8000/v1',
    headers: [],
    secretHeaderNames: [],
    models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
    defaultModel: 'llama-3.1',
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
  };
}
