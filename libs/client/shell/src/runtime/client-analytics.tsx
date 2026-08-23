import type {PropsWithChildren} from 'react';
import {createContext, useContext, useMemo} from 'react';

/**
 * Application-provided UI analytics. Call `capture` from an effect or event
 * handler, not during render. The provider isolates synchronous and
 * asynchronous implementation failures.
 */
export interface ClientAnalytics {
  capture(event: string, properties?: Record<string, unknown>): void | PromiseLike<void>;
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
  const safeAnalytics = useMemo(
    () => (analytics ? createSafeClientAnalytics(analytics) : noopClientAnalytics),
    [analytics],
  );

  return (
    <ClientAnalyticsContext.Provider value={safeAnalytics}>
      {children}
    </ClientAnalyticsContext.Provider>
  );
}

export function useClientAnalytics(): ClientAnalytics {
  return useContext(ClientAnalyticsContext);
}

function createSafeClientAnalytics(analytics: ClientAnalytics): ClientAnalytics {
  return {
    capture(event, properties) {
      try {
        void Promise.resolve(analytics.capture(event, properties)).catch(() => undefined);
      } catch {
        // Optional analytics must not interrupt a feature render or user action.
      }
    },
  };
}
