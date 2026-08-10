import {type App, Octokit} from 'octokit';
import {config, normalizedGithubApiBaseUrl} from '#config.js';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {recordInstallationTokenFormat} from '#metrics/index.js';

const INSTALLATION_TOKEN_REQUEST_PATH = /\/app\/installations\/[^/]+\/access_tokens(?:\?|$)/u;
type GithubInstallationTokenFormatOverride = 'enabled' | 'disabled' | undefined;

export function createGithubInstallationTokenFormatPlugin(
  override: GithubInstallationTokenFormatOverride,
): Parameters<typeof Octokit.plugin>[0] {
  return (octokit) => {
    octokit.hook.before('request', (options) => {
      if (
        !override ||
        options.method !== 'POST' ||
        !INSTALLATION_TOKEN_REQUEST_PATH.test(options.url)
      ) {
        return;
      }

      options.headers['x-github-stateless-s2s-token'] = override;
    });
  };
}

export const githubInstallationTokenFormatPlugin: Parameters<typeof Octokit.plugin>[0] =
  createGithubInstallationTokenFormatPlugin(config.GITHUB_INSTALLATION_TOKEN_FORMAT_OVERRIDE);

export async function getGithubInstallationOctokit(
  app: App,
  installationId: number,
  baseUrl = normalizedGithubApiBaseUrl(),
): Promise<Octokit> {
  const authentication = (await app.octokit.auth({
    type: 'installation',
    installationId,
  })) as {token?: unknown};

  if (typeof authentication.token !== 'string') {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub installation authentication did not include a token',
    );
  }

  recordInstallationTokenFormat(authentication.token);
  return new Octokit({auth: authentication.token, baseUrl});
}
