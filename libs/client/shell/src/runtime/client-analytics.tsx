import type {PropsWithChildren} from 'react';
import {createContext, useContext} from 'react';

export interface ClientAnalytics {
  capture(event: string, properties?: Record<string, unknown>): void;
}

/** Analytics that discards every event; the default for self-hosted builds. */
export const noopClientAnalytics: ClientAnalytics = {
  capture() {
    // UI analytics are optional; the open-source client has no telemetry endpoint.
  },
};

const ClientAnalyticsContext = createContext<ClientAnalytics>(noopClientAnalytics);

export function ClientAnalyticsProvider({
  analytics,
  children,
}: PropsWithChildren<{analytics?: ClientAnalytics}>) {
  return (
    <ClientAnalyticsContext.Provider value={analytics ?? noopClientAnalytics}>
      {children}
    </ClientAnalyticsContext.Provider>
  );
}

export function useClientAnalytics(): ClientAnalytics {
  return useContext(ClientAnalyticsContext);
}
