import {
  type ManagedModelProvider,
  MODEL_PROVIDER_CATALOG_SEED,
  type ModelProviderCatalogEntryDto,
  modelProviderCatalogEntrySchema,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {listPiProviderModels} from './harness/pi.js';

let cachedCatalog: readonly ModelProviderCatalogEntryDto[] | undefined;

export function buildModelProviderCatalog(
  options: {
    managedProvider?: ManagedModelProvider | undefined;
    workspaceProviders?: WorkspaceProvidersPolicy | undefined;
  } = {},
): readonly ModelProviderCatalogEntryDto[] {
  const workspaceProviders = options.workspaceProviders ?? 'enabled';
  if (workspaceProviders === 'disabled') {
    if (options.managedProvider === undefined) {
      throw new Error(
        'workspace provider configuration is disabled but no managed provider is registered',
      );
    }
    return Object.freeze([toManagedProviderCatalogEntry(options.managedProvider)]);
  }

  const catalog = getCatalog();
  if (options.managedProvider === undefined) return catalog;

  return Object.freeze([...catalog, toManagedProviderCatalogEntry(options.managedProvider)]);
}

function getCatalog(): readonly ModelProviderCatalogEntryDto[] {
  if (cachedCatalog) return cachedCatalog;

  const catalog = modelProviderCatalogEntrySchema.array().parse(
    MODEL_PROVIDER_CATALOG_SEED.map((entry) => ({
      ...entry,
      credential_fields: entry.credential_fields.map((field) => ({...field})),
      models: entry.support_status === 'supported' ? listPiProviderModels(entry.id) : [],
    })),
  );

  cachedCatalog = deepFreeze(catalog);
  return cachedCatalog;
}

function toManagedProviderCatalogEntry(
  managedProvider: ManagedModelProvider,
): ModelProviderCatalogEntryDto {
  return deepFreeze(
    modelProviderCatalogEntrySchema.parse({
      id: managedProvider.id,
      label: managedProvider.label,
      support_status: 'supported',
      default_model: managedProvider.defaultModel,
      credential_fields: [],
      unsupported_reason: null,
      models: managedProvider.models.map(({id, label, api}) => ({id, label, api})),
    }),
  );
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
  }

  return Object.freeze(value);
}
