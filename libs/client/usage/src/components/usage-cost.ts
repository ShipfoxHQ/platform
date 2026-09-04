import {
  type ClientUsagePricing,
  type UsagePricingCost,
  type UsagePricingQuantities,
  type UsagePricingReference,
  type UsagePricingResolution,
  usagePricingReferenceKey,
  useUsagePricing,
} from '@shipfox/client-shell/runtime';
import {useEffect, useMemo, useState} from 'react';

export interface UsageCostRequest {
  reference: UsagePricingReference;
  quantities?: UsagePricingQuantities;
}

export function useUsageCosts(
  inputs: readonly UsageCostRequest[],
): ReadonlyMap<string, UsagePricingCost> {
  const pricing = useUsagePricing();
  const requests = useMemo(() => inputs.map((input) => ({...input})), [inputs]);
  const [costs, setCosts] = useState<ReadonlyMap<string, UsagePricingCost>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    if (!pricing || requests.length === 0) {
      setCosts(new Map());
      return () => {
        cancelled = true;
      };
    }

    setCosts(new Map());
    void loadUsageCosts({pricing, requests}).then((nextCosts) => {
      if (!cancelled) setCosts(nextCosts);
    });

    return () => {
      cancelled = true;
    };
  }, [pricing, requests]);

  return costs;
}

export function usagePricingCostFromResolution(
  resolution: UsagePricingResolution,
  reference: UsagePricingReference,
): UsagePricingCost | undefined {
  const key = usagePricingReferenceKey(reference);
  let candidate: UsagePricingCost | null | undefined;
  if (Array.isArray(resolution)) {
    const entry = resolution.find(
      (item) => item.kind === reference.kind && item.id === reference.id,
    );
    candidate = entry;
  } else if (isMapLike(resolution)) {
    candidate = resolution.get(key) ?? resolution.get(reference.id);
  } else {
    const record = resolution as Readonly<Record<string, UsagePricingCost | null | undefined>>;
    candidate = record[key] ?? record[reference.id];
  }

  return validUsagePricingCost(candidate) ? candidate : undefined;
}

export function formatUsageCost(
  pricing: ClientUsagePricing | undefined,
  cost: UsagePricingCost | undefined,
): string | undefined {
  if (!pricing || !cost) return undefined;
  try {
    const formatted = pricing.formatMoney(cost.amount);
    return formatted || undefined;
  } catch {
    return undefined;
  }
}

async function loadUsageCosts({
  pricing,
  requests,
}: {
  pricing: ClientUsagePricing;
  requests: readonly UsageCostRequest[];
}): Promise<ReadonlyMap<string, UsagePricingCost>> {
  const references = uniqueReferences(requests.map(({reference}) => reference));
  let resolution: UsagePricingResolution = new Map();
  try {
    resolution = await pricing.resolveCosts(references);
  } catch {
    resolution = new Map();
  }

  const costs = new Map<string, UsagePricingCost>();
  const missing = requests.filter(({reference}) => {
    const cost = usagePricingCostFromResolution(resolution, reference);
    if (!cost) return true;
    costs.set(usagePricingReferenceKey(reference), cost);
    return false;
  });

  await Promise.all(
    missing.map(async ({reference, quantities}) => {
      if (!quantities) return;
      try {
        const estimate = await pricing.estimate({reference, quantities});
        if (!validUsagePricingCost(estimate)) return;
        costs.set(usagePricingReferenceKey(reference), estimate);
      } catch {
        // A pricing failure is an absent cost, so quantity-only views remain usable.
      }
    }),
  );
  return costs;
}

function uniqueReferences(references: readonly UsagePricingReference[]): UsagePricingReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = usagePricingReferenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isMapLike(
  resolution: UsagePricingResolution,
): resolution is ReadonlyMap<string, UsagePricingCost | null | undefined> {
  return !Array.isArray(resolution) && typeof (resolution as {get?: unknown}).get === 'function';
}

function validUsagePricingCost(
  cost: UsagePricingCost | null | undefined,
): cost is UsagePricingCost {
  return (
    cost !== null &&
    cost !== undefined &&
    Number.isFinite(cost.amount) &&
    (cost.state === 'resolved' || cost.state === 'estimated')
  );
}
