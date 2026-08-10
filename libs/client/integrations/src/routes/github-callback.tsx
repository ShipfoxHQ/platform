import {ApiError} from '@shipfox/client-api';
import {useRefreshAuth} from '@shipfox/client-auth';
import {defineRoute, useRouteSearch} from '@shipfox/client-shell/runtime';
import {createSingleFlight} from '@shipfox/client-ui';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {useNavigate} from '@tanstack/react-router';
import {useEffect} from 'react';
import {useCompleteIntegrationCallback} from '#application/complete-integration-callback.js';
import {completeGithubCallback} from '#hooks/api/integrations.js';

export interface GithubCallbackParams {
  code: string;
  installationId: number;
  state: string;
  setupAction?: string;
}

export interface GithubCallbackSearch {
  code?: string;
  installationId?: number;
  state?: string;
  setupAction?: string;
}

// Retain only recent completions: this bounds long-lived callback pages while
// still covering StrictMode and immediate Back/Forward remounts.
const callbackRequests = createSingleFlight<string, void>({maxTerminalResults: 32});
const toastedCallbacks = new Set<string>();

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: validateGithubCallbackSearch,
  component: GithubCallbackRoute,
});

function GithubCallbackRoute() {
  const search = useRouteSearch(validateGithubCallbackSearch);
  const navigate = useNavigate();
  const refreshAuth = useRefreshAuth();
  const completeIntegrationCallback = useCompleteIntegrationCallback();

  useEffect(() => {
    const missing = missingCallbackParams(search);
    if (missing.length > 0) {
      toast.error(
        `GitHub callback is missing: ${missing.join(', ')}. ${missing.includes('code') ? 'Enable "Request user authorization (OAuth) during installation" on the Shipfox GitHub App.' : ''}`,
      );
      navigate({to: '/', replace: true});
      return;
    }
    const params = githubCallbackParams(search);
    if (!params) {
      toast.error('GitHub callback is missing required parameters.');
      navigate({to: '/', replace: true});
      return;
    }
    let disposed = false;
    const key = encodeCallbackQuery(params);
    const request = callbackRequests.run(
      key,
      async () =>
        void (await completeIntegrationCallback({
          input: params,
          refreshAuth,
          complete: async (input, token) => await completeGithubCallback({...input, token}),
        })),
    );
    request
      .then(() => {
        if (disposed) return;
        if (!toastedCallbacks.has(key)) {
          toastedCallbacks.add(key);
          toast.success('GitHub installed.');
        }
        navigate({to: '/', replace: true});
      })
      .catch((error: unknown) => {
        if (disposed) return;
        if (!toastedCallbacks.has(key)) {
          toastedCallbacks.add(key);
          toast.error(githubCallbackErrorMessage(error));
        }
        navigate({to: '/', replace: true});
      });
    return () => {
      disposed = true;
    };
  }, [completeIntegrationCallback, navigate, refreshAuth, search]);

  return <FullPageLoader />;
}

export function validateGithubCallbackSearch(input: Record<string, unknown>): GithubCallbackSearch {
  const code = stringParam(input.code);
  const installationId = numberParam(input.installation_id);
  const state = stringParam(input.state);
  const setupAction = stringParam(input.setup_action);
  return {
    ...(code ? {code} : {}),
    ...(installationId === undefined ? {} : {installationId}),
    ...(state ? {state} : {}),
    ...(setupAction ? {setupAction} : {}),
  };
}

export function missingCallbackParams(search: GithubCallbackSearch): string[] {
  const missing: string[] = [];
  if (!search.code) missing.push('code');
  if (search.installationId === undefined) missing.push('installation_id');
  if (!search.state) missing.push('state');
  return missing;
}
export function githubCallbackParams(
  search: GithubCallbackSearch,
): GithubCallbackParams | undefined {
  const {code, installationId, state} = search;
  if (!code || installationId === undefined || !state) return undefined;
  const {setupAction} = search;
  return setupAction ? {code, installationId, state, setupAction} : {code, installationId, state};
}
function encodeCallbackQuery(params: GithubCallbackParams): string {
  const search = new URLSearchParams();
  search.set('code', params.code);
  search.set('installation_id', params.installationId.toString());
  search.set('state', params.state);
  if (params.setupAction) search.set('setup_action', params.setupAction);
  return search.toString();
}
function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function numberParam(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
export function githubCallbackErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return 'GitHub could not be installed. Try again from settings.';
  return 'Could not install GitHub.';
}
