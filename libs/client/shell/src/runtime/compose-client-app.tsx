import {configureApiClient} from '@shipfox/client-api';
import {
  ConfigErrorScreen,
  getWindowRuntimeConfig,
  loadConfig,
  setLoadedConfig,
} from '@shipfox/client-config';
import {ThemeProvider} from '@shipfox/react-ui/theme';
import {Toaster} from '@shipfox/react-ui/toast';
import {TooltipProvider} from '@shipfox/react-ui/tooltip';
import {QueryClient} from '@tanstack/react-query';
import {type AnyRouter, RouterProvider} from '@tanstack/react-router';
import {createStore} from 'jotai';
import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {composeClientFeatures} from '#compose/compose-client-features.js';
import type {ClientFeature} from '#contract.js';
import {useAuthState} from './auth.js';
import {ChromeProvider, type ChromeSlots} from './chrome-context.js';
import {type ClientAnalytics, ClientAnalyticsProvider} from './client-analytics.js';
import {ShellProviderStack} from './provider-stack.js';
import type {WorkspaceSetupGate} from './workspace-setup.js';

export function composeClientApp({
  features,
  router,
  chrome,
  workspaceSetup,
  clientAnalytics,
}: {
  features: readonly ClientFeature[];
  router: AnyRouter;
  chrome?: ChromeSlots;
  workspaceSetup?: WorkspaceSetupGate;
  clientAnalytics?: ClientAnalytics;
}) {
  const composition = composeClientFeatures(features);
  const config = loadConfig(composition.configShape, {
    runtime: getWindowRuntimeConfig(),
    build: (import.meta as ImportMeta & {env?: Record<string, unknown>}).env,
  });
  if (config.ok) setLoadedConfig(config.config);

  return {
    mount(element: HTMLElement): () => void {
      const root = createRoot(element);
      const unmount = () => root.unmount();
      if (!config.ok) {
        root.render(
          <StrictMode>
            <ThemeProvider>
              <TooltipProvider>
                <ConfigErrorScreen errors={config.errors} />
              </TooltipProvider>
            </ThemeProvider>
          </StrictMode>,
        );
        return unmount;
      }

      configureApiClient({baseUrl: configApiUrl(config.config)});
      const queryClient = new QueryClient();
      root.render(
        <StrictMode>
          <ChromeProvider chrome={chrome}>
            <ClientAnalyticsProvider {...(clientAnalytics ? {analytics: clientAnalytics} : {})}>
              <ShellProviderStack
                features={features}
                queryClient={queryClient}
                store={createStore()}
              >
                <RoutedApp
                  router={router}
                  queryClient={queryClient}
                  workspaceSetup={workspaceSetup}
                  projectSlugResolver={chrome?.projectSlugResolver}
                />
                <Toaster />
              </ShellProviderStack>
            </ClientAnalyticsProvider>
          </ChromeProvider>
        </StrictMode>,
      );
      return unmount;
    },
  };
}

function RoutedApp({
  router,
  queryClient,
  workspaceSetup,
  projectSlugResolver,
}: {
  router: AnyRouter;
  queryClient: QueryClient;
  workspaceSetup: WorkspaceSetupGate | undefined;
  projectSlugResolver: ChromeSlots['projectSlugResolver'] | undefined;
}) {
  const auth = useAuthState();

  useEffect(() => {
    if (!auth.isLoading) router.invalidate();
  }, [auth.isLoading, router]);

  return (
    <RouterProvider
      router={router as never}
      context={{auth, queryClient, workspaceSetup, projectSlugResolver} as never}
    />
  );
}

function configApiUrl(config: unknown): string {
  if (
    typeof config !== 'object' ||
    config === null ||
    !('apiUrl' in config) ||
    typeof config.apiUrl !== 'string'
  ) {
    throw new Error('Composed client configuration must include a string apiUrl.');
  }
  return config.apiUrl;
}
