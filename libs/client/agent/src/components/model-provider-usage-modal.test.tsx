import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {CustomProviderConfig, SupportedProvider} from '#core/models.js';
import {ModelProviderUsageModal} from './model-provider-usage-modal.js';
import {
  usageTargetFromCatalogEntry,
  usageTargetFromCustomConfig,
} from './model-provider-usage-target.js';

const CLAUDE_MODEL_ROW_NAME = 'Copy Claude Opus 4.8 model id claude-opus-4-8';
const KIMI_MODEL_ROW_NAME = 'Copy Kimi K2.7 Code model id @cf/moonshotai/kimi-k2.7-code';

function renderUsageModal() {
  const onOpenChange = vi.fn();
  const entry = supportedProvider({
    defaultModel: 'claude-opus-4-8',
    models: [
      {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
      {id: '@cf/moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code'},
    ],
  });

  render(
    <ModelProviderUsageModal
      target={usageTargetFromCatalogEntry(entry)}
      initialModel="claude-opus-4-8"
      open
      onOpenChange={onOpenChange}
    />,
  );

  return {entry, onOpenChange};
}

describe('ModelProviderUsageModal', () => {
  test('changes the selected model in the workflow example', async () => {
    renderUsageModal();
    await waitFor(() =>
      expect(screen.getByRole('dialog', {name: 'Use Anthropic in a workflow'})).toHaveTextContent(
        'harness: pi',
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('dialog', {name: 'Use Anthropic in a workflow'})).toHaveTextContent(
        'model: claude-opus-4-8',
      ),
    );

    fireEvent.click(screen.getByRole('button', {name: 'Model'}));
    fireEvent.click(await screen.findByRole('option', {name: 'Kimi K2.7 Code'}));

    await waitFor(() =>
      expect(screen.getByRole('dialog', {name: 'Use Anthropic in a workflow'})).toHaveTextContent(
        "model: '@cf/moonshotai/kimi-k2.7-code'",
      ),
    );
    expect(screen.getByRole('dialog', {name: 'Use Anthropic in a workflow'})).not.toHaveTextContent(
      'model: claude-opus-4-8',
    );
  }, 10_000);

  test('changes the selected harness in the workflow example', async () => {
    renderUsageModal();
    await waitFor(() =>
      expect(screen.getByRole('dialog', {name: 'Use Anthropic in a workflow'})).toHaveTextContent(
        'harness: pi',
      ),
    );

    fireEvent.click(screen.getByRole('button', {name: 'Harness'}));
    fireEvent.click(await screen.findByRole('option', {name: 'Claude'}));

    await waitFor(() =>
      expect(screen.getByRole('dialog', {name: 'Use Anthropic in a workflow'})).toHaveTextContent(
        'harness: claude',
      ),
    );
  });

  test('does not offer Claude when managed models do not support Anthropic messages', async () => {
    const onOpenChange = vi.fn();
    const entry = supportedProvider({
      id: 'shipfox',
      label: 'Shipfox Managed',
      defaultModel: 'gpt-5.5-pro',
      models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', api: 'openai-responses'}],
    });

    render(
      <ModelProviderUsageModal
        target={usageTargetFromCatalogEntry(entry, {isManaged: true})}
        initialModel="gpt-5.5-pro"
        open
        onOpenChange={onOpenChange}
      />,
    );

    const dialog = await screen.findByRole('dialog', {name: 'Use Shipfox Managed in a workflow'});
    expect(dialog).toHaveTextContent('harness: pi');
    expect(screen.queryByRole('button', {name: 'Harness'})).not.toBeInTheDocument();
  });

  test('uses the workspace default harness when it is compatible', async () => {
    const onOpenChange = vi.fn();
    const entry = supportedProvider();

    render(
      <ModelProviderUsageModal
        target={usageTargetFromCatalogEntry(entry)}
        initialModel="claude-opus-4-8"
        workspaceDefaultHarnessId="claude"
        open
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('dialog', {name: 'Use Anthropic in a workflow'})).toHaveTextContent(
        'harness: claude',
      ),
    );
  });

  test('clamps the selected harness when the target changes', async () => {
    const onOpenChange = vi.fn();
    const anthropic = supportedProvider();
    const openai = supportedProvider({
      id: 'openai',
      label: 'OpenAI',
      models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
    });
    const {rerender} = render(
      <ModelProviderUsageModal
        target={usageTargetFromCatalogEntry(anthropic)}
        initialModel="claude-opus-4-8"
        workspaceDefaultHarnessId="claude"
        open
        onOpenChange={onOpenChange}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('dialog', {name: 'Use Anthropic in a workflow'})).toHaveTextContent(
        'harness: claude',
      ),
    );

    rerender(
      <ModelProviderUsageModal
        target={usageTargetFromCatalogEntry(openai)}
        initialModel="gpt-5.5-pro"
        workspaceDefaultHarnessId="claude"
        open
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('dialog', {name: 'Use OpenAI in a workflow'})).toHaveTextContent(
        'harness: pi',
      ),
    );
    expect(screen.queryByRole('button', {name: 'Harness'})).not.toBeInTheDocument();
  });

  test('renders a static pi harness line for custom providers', async () => {
    const onOpenChange = vi.fn();

    render(
      <ModelProviderUsageModal
        target={usageTargetFromCustomConfig(customProviderConfig())}
        initialModel="custom-model"
        workspaceDefaultHarnessId="claude"
        open
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('dialog', {name: 'Use OpenAI Compatible in a workflow'}),
      ).toHaveTextContent('harness: pi'),
    );
    expect(screen.getByText('Harness')).toBeVisible();
    expect(screen.getAllByText('pi').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', {name: 'Harness'})).not.toBeInTheDocument();
  });

  test('renders reference models as clickable rows with inline ids', async () => {
    renderUsageModal();

    const list = await screen.findByRole('list');
    expect(within(list).getByText('Claude Opus 4.8')).toBeVisible();
    expect(within(list).getByText('@cf/moonshotai/kimi-k2.7-code')).toBeVisible();
    expect(within(list).getByRole('button', {name: KIMI_MODEL_ROW_NAME})).toBeVisible();
  });

  test('copies the full model id', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText},
    });

    renderUsageModal();
    await user.click(await screen.findByRole('button', {name: KIMI_MODEL_ROW_NAME}));

    expect(writeText).toHaveBeenCalledWith('@cf/moonshotai/kimi-k2.7-code');
    expect(await screen.findAllByText('Copied')).toHaveLength(2);
    expect(await screen.findByRole('status')).toHaveTextContent('Copied Kimi K2.7 Code id');
  });

  test('shows failed copy feedback', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText},
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });

    renderUsageModal();
    await user.click(await screen.findByRole('button', {name: CLAUDE_MODEL_ROW_NAME}));

    await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith('copy'));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Could not copy Claude Opus 4.8 id',
    );
  });
});

function supportedProvider(overrides: Partial<SupportedProvider> = {}): SupportedProvider {
  return {
    kind: 'supported',
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-opus-4-8',
    credentialFields: [{key: 'api_key', label: 'API key', secret: true}],
    models: [{id: 'claude-opus-4-8', label: 'Claude Opus 4.8'}],
    ...overrides,
  };
}

function customProviderConfig(): CustomProviderConfig {
  return {
    kind: 'custom',
    providerId: 'openai-compatible',
    displayName: 'OpenAI Compatible',
    api: 'openai-completions',
    baseUrl: 'https://llm.example.test/v1',
    headers: [],
    secretHeaderNames: [],
    models: [{id: 'custom-model', label: 'Custom Model'}],
    defaultModel: 'custom-model',
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
  };
}
