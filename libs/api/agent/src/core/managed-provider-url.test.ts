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

  it.each([
    {
      baseUrl: 'https://gateway.example.test/v1-team/inference',
      expectedOpenAi: 'https://gateway.example.test/v1-team/inference/v1',
      expectedAnthropic: 'https://gateway.example.test/v1-team/inference',
    },
    {
      baseUrl: 'https://gateway.example.test/control-plane/inference/v1/v1',
      expectedOpenAi: 'https://gateway.example.test/control-plane/inference/v1',
      expectedAnthropic: 'https://gateway.example.test/control-plane/inference',
    },
    {
      baseUrl: 'https://gateway.example.test/control-plane/inference/v1/?tenant=staging#runtime',
      expectedOpenAi: 'https://gateway.example.test/control-plane/inference/v1',
      expectedAnthropic: 'https://gateway.example.test/control-plane/inference',
    },
  ])('preserves path prefixes and produces a client-safe URL for %s', ({
    baseUrl,
    expectedOpenAi,
    expectedAnthropic,
  }) => {
    expect(managedProviderAdapterBaseUrl(api, baseUrl)).toBe(
      api === 'anthropic-messages' ? expectedAnthropic : expectedOpenAi,
    );
  });
});

it.each([
  'not a url',
  'localhost:8000/inference',
])('passes malformed values through for runtime DTO validation: %s', (baseUrl) => {
  expect(managedProviderAdapterBaseUrl('openai-responses', baseUrl)).toBe(baseUrl);
});
