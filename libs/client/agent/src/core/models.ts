export type HarnessId = 'pi' | 'claude';
export type WorkspaceProvidersPolicy = 'enabled' | 'disabled';
export type ProviderApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai';

export interface HarnessDescriptor {
  readonly id: HarnessId;
  readonly label: string;
  readonly description: string;
  readonly supportedProviderIds: readonly string[];
}

export interface AgentModel {
  readonly id: string;
  readonly label: string;
  readonly contextWindow?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly inputImage?: boolean | undefined;
  readonly reasoning?: boolean | undefined;
}

export interface CredentialField {
  readonly key: string;
  readonly label: string;
  readonly secret: boolean;
}

export interface SupportedProvider {
  readonly kind: 'supported';
  readonly id: string;
  readonly label: string;
  readonly defaultModel: string | null;
  readonly credentialFields: readonly CredentialField[];
  readonly models: readonly AgentModel[];
}

export interface UnsupportedProvider {
  readonly kind: 'unsupported';
  readonly id: string;
  readonly label: string;
  readonly unsupportedReason: string;
}

export type ProviderCatalogEntry = SupportedProvider | UnsupportedProvider;

export interface BuiltinProviderConfig {
  readonly kind: 'builtin';
  readonly providerId: string;
  readonly defaultModel: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProviderHeader {
  readonly name: string;
  readonly value: string;
}

export interface CustomProviderConfig {
  readonly kind: 'custom';
  readonly providerId: string;
  readonly displayName: string;
  readonly api: ProviderApi;
  readonly baseUrl: string;
  readonly headers: readonly ProviderHeader[];
  readonly secretHeaderNames: readonly string[];
  readonly models: readonly AgentModel[];
  readonly defaultModel: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ProviderConfig = BuiltinProviderConfig | CustomProviderConfig;

export interface ProviderCatalog {
  readonly providers: readonly ProviderCatalogEntry[];
  readonly workspaceProviders: WorkspaceProvidersPolicy;
}

export interface ProviderConfiguration {
  readonly configs: readonly ProviderConfig[];
  readonly defaultHarnessId: HarnessId | null;
  readonly defaultProviderId: string | null;
}

export interface DefaultModelProviderSelection {
  readonly defaultProviderId: string | null;
}

export interface DefaultHarnessSelection {
  readonly defaultHarnessId: HarnessId;
}

export interface ProviderCredentialsCommand {
  defaultModel?: string | null | undefined;
  credentials: Record<string, string>;
  setAsDefault?: boolean | undefined;
}

export interface CustomProviderHeaderCommand {
  name: string;
  value?: string | undefined;
  secret: boolean;
  keep?: boolean | undefined;
}

export interface CustomProviderModelCommand {
  id: string;
  label: string;
  contextWindow?: number | undefined;
  maxOutputTokens?: number | undefined;
  inputImage?: boolean | undefined;
  reasoning?: boolean | undefined;
}

export interface CreateCustomProviderCommand {
  slug: string;
  displayName: string;
  api: ProviderApi;
  baseUrl: string;
  apiKey?: string | undefined;
  headers?: CustomProviderHeaderCommand[] | undefined;
  models: CustomProviderModelCommand[];
  defaultModel?: string | null | undefined;
}

export interface UpdateCustomProviderCommand {
  displayName?: string | undefined;
  api?: ProviderApi | undefined;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  headers?: CustomProviderHeaderCommand[] | undefined;
  models?: CustomProviderModelCommand[] | undefined;
  defaultModel?: string | null | undefined;
}

export interface DiscoverProviderModelsCommand {
  api?: ProviderApi | undefined;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  headers?: CustomProviderHeaderCommand[] | undefined;
}
