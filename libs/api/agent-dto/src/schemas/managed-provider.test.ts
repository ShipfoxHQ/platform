import {
  managedModelCompatSchema,
  managedModelMetadataSchema,
  toCustomAgentModelDto,
} from './managed-provider.js';

describe('managed provider model metadata', () => {
  it('maps Pi metadata to the runtime DTO without changing omitted map entries', () => {
    const thinkingLevelMap = {off: null, high: 'high'} as const;
    const compat = {
      supportsDeveloperRole: false,
      supportsStrictMode: true,
      supportsToolSearch: true,
      supportsExplicitPromptCacheMode: true,
    } as const;

    const dto = toCustomAgentModelDto({
      id: 'gpt-5.6-sol',
      label: 'GPT 5.6 Sol',
      thinkingLevelMap,
      compat,
    });

    expect(dto).toEqual({
      id: 'gpt-5.6-sol',
      label: 'GPT 5.6 Sol',
      thinking_level_map: thinkingLevelMap,
      compat,
    });
    expect(dto.thinking_level_map).not.toHaveProperty('medium');
    expect(toCustomAgentModelDto({id: 'plain', label: 'Plain'})).toEqual({
      id: 'plain',
      label: 'Plain',
    });
  });

  it('normalizes legacy snake-case Pi metadata', () => {
    const thinkingLevelMap = {off: null, high: 'high'} as const;

    expect(
      toCustomAgentModelDto({
        id: 'legacy-model',
        label: 'Legacy model',
        thinking_level_map: thinkingLevelMap,
      }),
    ).toEqual({
      id: 'legacy-model',
      label: 'Legacy model',
      thinking_level_map: thinkingLevelMap,
    });
  });

  it('accepts typed Pi compatibility variants and rejects unsupported fields', () => {
    expect(
      managedModelCompatSchema.parse({
        forceAdaptiveThinking: true,
        supportsStrictTools: true,
      }),
    ).toEqual({forceAdaptiveThinking: true, supportsStrictTools: true});
    expect(managedModelCompatSchema.safeParse({thinkingFormat: 'unsupported'}).success).toBe(false);
    expect(
      managedModelMetadataSchema.safeParse({
        thinkingLevelMap: {minimal: null},
        compat: {supportsStore: false, thinkingFormat: 'deepseek'},
      }).success,
    ).toBe(true);
    expect(
      managedModelMetadataSchema.safeParse({
        thinkingLevelMap: {minimal: null},
        thinking_level_map: {minimal: null},
      }).success,
    ).toBe(false);
  });
});
