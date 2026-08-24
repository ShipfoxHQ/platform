import type {ManagedModelApi} from '@shipfox/api-agent-dto';

const TRAILING_SLASHES_PATTERN = /\/+$/u;
const TRAILING_API_VERSION_PATTERN = /(?:\/v1)+$/u;

/**
 * Converts the managed provider's declared gateway root into the base URL
 * expected by the client for its API dialect.
 *
 * OpenAI clients append their operation path to a `/v1` base, while Anthropic
 * clients append `/v1/messages` themselves. Deployment path prefixes remain
 * untouched, and a version suffix is normalized before the dialect is applied.
 * Query and fragment components are omitted because clients append operations
 * to the base URL as path components.
 */
export function managedProviderAdapterBaseUrl(
  api: ManagedModelApi,
  gatewayBaseUrl: string,
): string {
  let url: URL;
  try {
    url = new URL(gatewayBaseUrl);
  } catch {
    // Preserve the existing downstream DTO validation for malformed provider data.
    return gatewayBaseUrl;
  }

  url.search = '';
  url.hash = '';
  const gatewayPath = url.pathname
    .replace(TRAILING_SLASHES_PATTERN, '')
    .replace(TRAILING_API_VERSION_PATTERN, '');
  const adapterPath = api === 'anthropic-messages' ? gatewayPath : `${gatewayPath}/v1`;

  return `${url.origin}${adapterPath}`;
}
