import type {PropsWithChildren} from 'react';
import {createContext, useContext, useMemo} from 'react';

export type UsagePricingReferenceKind = 'run' | 'job-execution' | 'step-attempt';

export interface UsagePricingReference {
  kind: UsagePricingReferenceKind;
  id: string;
}

export interface UsagePricingQuantities {
  computeSeconds: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

export interface UsagePricingEstimateInput {
  reference: UsagePricingReference;
  quantities: UsagePricingQuantities;
}

export type UsagePricingCostState = 'resolved' | 'estimated';

export interface UsagePricingCost {
  amount: number;
  state: UsagePricingCostState;
}

export interface UsagePricingCostEntry extends UsagePricingReference, UsagePricingCost {}

export type UsagePricingResolution =
  | ReadonlyMap<string, UsagePricingCost | null | undefined>
  | Readonly<Record<string, UsagePricingCost | null | undefined>>
  | readonly UsagePricingCostEntry[];

/**
 * Application-owned pricing for the quantity-only Usage package.
 *
 * `resolveCosts` should key map or record results with `usagePricingReferenceKey`, or return
 * entries that include their reference. Pricing is optional and every operation is isolated by
 * the shell provider so an unavailable billing service cannot interrupt the client.
 */
export interface ClientUsagePricing {
  resolveCosts(
    refs: readonly UsagePricingReference[],
  ): UsagePricingResolution | PromiseLike<UsagePricingResolution>;
  estimate(
    input: UsagePricingEstimateInput,
  ): UsagePricingCost | null | PromiseLike<UsagePricingCost | null>;
  formatMoney(amount: number): string;
}

/** Alias for consumers that use the shorter seam name. */
export type UsagePricing = ClientUsagePricing;

const ClientUsagePricingContext = createContext<ClientUsagePricing | undefined>(undefined);

export function ClientUsagePricingProvider({
  usagePricing,
  children,
}: PropsWithChildren<{usagePricing?: ClientUsagePricing}>) {
  const safeUsagePricing = useMemo(
    () => (usagePricing ? createSafeClientUsagePricing(usagePricing) : undefined),
    [usagePricing],
  );

  return (
    <ClientUsagePricingContext.Provider value={safeUsagePricing}>
      {children}
    </ClientUsagePricingContext.Provider>
  );
}

export function useUsagePricing(): ClientUsagePricing | undefined {
  return useContext(ClientUsagePricingContext);
}

export function usagePricingReferenceKey(reference: UsagePricingReference): string {
  return `${reference.kind}:${reference.id}`;
}

function createSafeClientUsagePricing(pricing: ClientUsagePricing): ClientUsagePricing {
  return {
    resolveCosts(refs) {
      try {
        return Promise.resolve(pricing.resolveCosts(refs)).catch(() => new Map());
      } catch {
        return new Map();
      }
    },
    estimate(input) {
      try {
        return Promise.resolve(pricing.estimate(input)).catch(() => null);
      } catch {
        return null;
      }
    },
    formatMoney(amount) {
      try {
        const formatted = pricing.formatMoney(amount);
        return typeof formatted === 'string' ? formatted : '';
      } catch {
        return '';
      }
    },
  };
}
