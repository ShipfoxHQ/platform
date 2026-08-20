import type {CustomProviderConfig, SupportedProvider} from '#core/models.js';

export interface ModelProviderUsageTarget {
  id: string;
  label: string;
  isCustom: boolean;
  isManaged: boolean;
  models: ReadonlyArray<{id: string; label: string}>;
  defaultModel: string | null;
}

export function usageTargetFromCatalogEntry(
  entry: SupportedProvider,
  options: {isManaged?: boolean} = {},
): ModelProviderUsageTarget {
  const provider = entry;
  return {
    id: provider.id,
    label: provider.label,
    isCustom: false,
    isManaged: options.isManaged ?? false,
    models: provider.models,
    defaultModel: provider.defaultModel,
  };
}

export function usageTargetFromCustomConfig(
  config: CustomProviderConfig,
): ModelProviderUsageTarget {
  const provider = config;
  return {
    id: provider.providerId,
    label: provider.displayName,
    isCustom: true,
    isManaged: false,
    models: provider.models,
    defaultModel: provider.defaultModel,
  };
}
