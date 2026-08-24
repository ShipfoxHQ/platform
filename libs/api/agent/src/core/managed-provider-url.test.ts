import type {ManagedModelApi} from '@shipfox/api-agent-dto';
import {managedProviderAdapterBaseUrl} from './managed-provider-url.js';

const baseUrlVariants = [
  'https://gateway.example.test/inference',
  'https://gateway.example.test/inference/',
  'https://gateway.example.test/inference/v1',
  'https://gateway.example.test/inference/v1/',
] as const;

describe.each([
  {api: 'openai-responses', expectedPath: '/inference/v1'},
  {api: 'openai-completions', expectedPath: '/inference/v1'},
  {api: 'anthropic-messages', expectedPath: '/inference'},
] satisfies readonly {api: ManagedModelApi; expectedPath: string}[])('$api', ({
  api,
  expectedPath,
}) => {
  it.each(baseUrlVariants)('normalizes %s without duplicating the dialect version', (baseUrl) => {
    expect(managedProviderAdapterBaseUrl(api, baseUrl)).toBe(
      `https://gateway.example.test${expectedPath}`,
    );
  });

  it('preserves a deployment path prefix and URL components', () => {
    expect(
      managedProviderAdapterBaseUrl(
        api,
        'https://gateway.example.test/control-plane/inference/v1/?tenant=staging#runtime',
      ),
    ).toBe(
      `https://gateway.example.test/control-plane${expectedPath === '/inference/v1' ? '/inference/v1' : '/inference'}?tenant=staging#runtime`,
    );
  });
});
