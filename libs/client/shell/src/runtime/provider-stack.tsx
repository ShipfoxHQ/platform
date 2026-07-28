import {ThemeProvider} from '@shipfox/react-ui/theme';
import {TooltipProvider} from '@shipfox/react-ui/tooltip';
import {type QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {type createStore, Provider as JotaiProvider} from 'jotai';
import type {PropsWithChildren, ReactNode} from 'react';
import type {ClientFeature} from '#contract.js';
import {AuthRuntime, type AuthRuntimeProps} from './auth.js';
import {LayoutNavigationProvider} from './layout-navigation.js';

type Store = ReturnType<typeof createStore>;

export function ShellProviderStack({
  features,
  queryClient,
  store,
  auth,
  children,
}: PropsWithChildren<{
  features: readonly ClientFeature[];
  queryClient: QueryClient;
  store: Store;
  auth?: Pick<AuthRuntimeProps, 'effects'>;
}>) {
  const featureProviders = features.flatMap((feature) => feature.providers ?? []);
  const nestedProviders = featureProviders.reduceRight<ReactNode>(
    (content, provider) => <provider.Component key={provider.id}>{content}</provider.Component>,
    children,
  );
  return (
    <ThemeProvider>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <JotaiProvider store={store}>
            <LayoutNavigationProvider features={features}>
              <AuthRuntime {...auth}>{nestedProviders}</AuthRuntime>
            </LayoutNavigationProvider>
          </JotaiProvider>
        </QueryClientProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
