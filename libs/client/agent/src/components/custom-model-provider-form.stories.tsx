import {configureApiClient} from '@shipfox/client-api';
import {Modal, ModalContent, ModalHeader, ModalTitle} from '@shipfox/react-ui/modal';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useMemo, useState} from 'react';
import type {CustomProviderConfig} from '#core/models.js';
import {CustomModelProviderForm} from './custom-model-provider-form.js';

interface CustomModelProviderFormStoryProps {
  mode: 'create' | 'edit';
}

function CustomModelProviderFormStory({mode}: CustomModelProviderFormStoryProps) {
  const [open, setOpen] = useState(true);
  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify({models: []}))),
  });

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background-subtle-base p-24">
        <Modal open={open} onOpenChange={setOpen}>
          <ModalContent
            className="max-h-[min(760px,calc(100vh-32px))]"
            aria-describedby={undefined}
          >
            <ModalTitle className="sr-only">
              {mode === 'edit' ? 'Edit custom provider' : 'Add custom provider'}
            </ModalTitle>
            <ModalHeader title={mode === 'edit' ? 'Edit custom provider' : 'Add custom provider'} />
            <CustomModelProviderForm
              workspaceId="11111111-1111-4111-8111-111111111111"
              existingConfig={mode === 'edit' ? customConfig() : undefined}
              onSaved={() => setOpen(false)}
            />
          </ModalContent>
        </Modal>
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Agent/CustomProviderForm',
  component: CustomModelProviderFormStory,
  parameters: {layout: 'fullscreen'},
  args: {mode: 'create'},
} satisfies Meta<typeof CustomModelProviderFormStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const EditStoredSecrets: Story = {
  args: {mode: 'edit'},
};

function customConfig(): CustomProviderConfig {
  return {
    kind: 'custom',
    providerId: 'local-vllm',
    displayName: 'Local vLLM',
    api: 'openai-completions',
    baseUrl: 'http://localhost:8000/v1',
    headers: [{name: 'x-region', value: 'us'}],
    secretHeaderNames: ['authorization'],
    models: [
      {
        id: 'llama-3.1',
        label: 'Llama 3.1',
        contextWindow: 128000,
        maxOutputTokens: 16384,
      },
      {
        id: 'qwen-coder',
        label: 'Qwen Coder',
        contextWindow: 32768,
        maxOutputTokens: 8192,
      },
    ],
    defaultModel: 'llama-3.1',
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
  };
}
