import {agentRuntimeCredentialsResponseSchema} from './runtime-config.js';

describe('agentRuntimeCredentialsResponseSchema', () => {
  it('parses runtime credentials for a supported provider', () => {
    const parsed = agentRuntimeCredentialsResponseSchema.parse({
      harness: 'pi',
      provider_id: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      credentials: {api_key: 'secret'},
    });

    expect(parsed.provider_id).toBe('anthropic');
  });

  it('parses runtime credentials with a custom model provider descriptor', () => {
    const parsed = agentRuntimeCredentialsResponseSchema.parse({
      harness: 'pi',
      provider_id: 'local-vllm',
      model: 'llama-3.1',
      thinking: 'high',
      credentials: {api_key: 'secret', authorization: 'Bearer secret'},
      custom_provider: {
        api: 'openai-responses',
        base_url: 'https://llm.example.test/v1',
        headers: [{name: 'x-region', value: 'local'}],
        secret_header_names: ['authorization'],
        models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
        requires_api_key: true,
      },
    });

    expect(parsed.provider_id).toBe('local-vllm');
    expect(parsed.custom_provider?.api).toBe('openai-responses');
  });

  it('parses managed Claude runtime credentials without a custom provider descriptor', () => {
    const parsed = agentRuntimeCredentialsResponseSchema.parse({
      harness: 'claude',
      provider_id: 'shipfox',
      model: 'managed-claude',
      thinking: 'high',
      credentials: {api_key: 'managed-token'},
      claude: {
        base_url: 'https://gateway.example.test',
        auth_token: 'managed-token',
      },
    });

    expect(parsed.claude).toEqual({
      base_url: 'https://gateway.example.test',
      auth_token: 'managed-token',
    });
  });

  it('rejects a custom model provider descriptor without key intent', () => {
    const parse = () =>
      agentRuntimeCredentialsResponseSchema.parse({
        harness: 'pi',
        provider_id: 'local-vllm',
        model: 'llama-3.1',
        thinking: 'high',
        credentials: {api_key: 'secret'},
        custom_provider: {
          api: 'openai-responses',
          base_url: 'https://llm.example.test/v1',
          headers: [],
          secret_header_names: [],
          models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
        },
      });

    expect(parse).toThrow();
  });

  it('rejects custom model provider runtime credentials without a custom model provider descriptor', () => {
    const parse = () =>
      agentRuntimeCredentialsResponseSchema.parse({
        harness: 'pi',
        provider_id: 'local-vllm',
        model: 'llama-3.1',
        thinking: 'high',
        credentials: {api_key: 'secret'},
      });

    expect(parse).toThrow();
  });

  it('rejects a response without a model', () => {
    const parse = () =>
      agentRuntimeCredentialsResponseSchema.parse({
        harness: 'pi',
        provider_id: 'anthropic',
        thinking: 'high',
        credentials: {api_key: 'secret'},
      });

    expect(parse).toThrow();
  });

  it('rejects a response without thinking', () => {
    const parse = () =>
      agentRuntimeCredentialsResponseSchema.parse({
        harness: 'pi',
        provider_id: 'anthropic',
        model: 'claude-opus-4-8',
        credentials: {api_key: 'secret'},
      });

    expect(parse).toThrow();
  });

  it('rejects runtime credentials for an invalid provider ref', () => {
    const parse = () =>
      agentRuntimeCredentialsResponseSchema.parse({
        harness: 'pi',
        provider_id: 'bad_provider',
        model: 'gpt-5.5-pro',
        thinking: 'high',
        credentials: {api_key: 'secret'},
      });

    expect(parse).toThrow();
  });

  it('rejects runtime credentials with an empty key', () => {
    const parse = () =>
      agentRuntimeCredentialsResponseSchema.parse({
        harness: 'pi',
        provider_id: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        credentials: {'': 'secret'},
      });

    expect(parse).toThrow();
  });

  it('rejects runtime credentials with an empty value', () => {
    const parse = () =>
      agentRuntimeCredentialsResponseSchema.parse({
        harness: 'pi',
        provider_id: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        credentials: {api_key: ''},
      });

    expect(parse).toThrow();
  });
});
