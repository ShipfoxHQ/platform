// @vitest-environment jsdom
import {act, screen} from '@testing-library/react';
import {useEffect} from 'react';
import {defineClientFeature} from '#contract.js';
import {
  type ClientUsagePricing,
  type UsagePricingReference,
  useUsagePricing,
} from '#runtime/client-usage-pricing.js';
import {renderComposedShell} from '#test/render.js';
import {defineRoute} from './define-route.js';

const reference: UsagePricingReference = {kind: 'run', id: 'run-1'};

function PricingProbe() {
  const pricing = useUsagePricing();
  useEffect(() => {
    if (!pricing) return;
    void pricing.resolveCosts([reference]);
    void pricing.estimate({
      reference,
      quantities: {
        computeSeconds: 1,
        requestCount: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
      },
    });
    pricing.formatMoney(1);
  }, [pricing]);
  return <h1>{pricing ? 'Pricing configured' : 'Pricing absent'}</h1>;
}

function pricingFeature() {
  return defineClientFeature({
    id: 'acme.pricing',
    routes: [{path: '/w/$workspaceSlug/pricing', parent: 'workspaceLayout', impl: 'pricing'}],
  });
}

async function renderPricingProbe(usagePricing?: ClientUsagePricing) {
  await renderComposedShell({
    features: [pricingFeature()],
    initialPath: '/w/workspace/pricing',
    resolveImpl: () => defineRoute({staticData: {frame: 'content'}, component: PricingProbe}),
    ...(usagePricing ? {usagePricing} : {}),
  });
}

describe('ClientUsagePricing', () => {
  test('is absent when no application pricing is composed', async () => {
    await renderPricingProbe();

    expect(await screen.findByRole('heading', {name: 'Pricing absent'})).toBeVisible();
  });

  test('wires all pricing operations through the composed provider', async () => {
    const resolveCosts = vi.fn(() => new Map());
    const estimate = vi.fn(() => ({amount: 1, state: 'estimated' as const}));
    const formatMoney = vi.fn(() => '$1.00');

    await renderPricingProbe({resolveCosts, estimate, formatMoney});

    expect(await screen.findByRole('heading', {name: 'Pricing configured'})).toBeVisible();
    expect(resolveCosts).toHaveBeenCalledWith([reference]);
    expect(estimate).toHaveBeenCalled();
    expect(formatMoney).toHaveBeenCalledWith(1);
  });

  test('contains synchronous implementation failures', async () => {
    const usagePricing: ClientUsagePricing = {
      resolveCosts: () => {
        throw new Error('pricing unavailable');
      },
      estimate: () => {
        throw new Error('pricing unavailable');
      },
      formatMoney: () => {
        throw new Error('pricing unavailable');
      },
    };

    await renderPricingProbe(usagePricing);

    expect(await screen.findByRole('heading', {name: 'Pricing configured'})).toBeVisible();
  });

  test('contains asynchronously rejected implementation failures', async () => {
    const usagePricing: ClientUsagePricing = {
      resolveCosts: () => Promise.reject(new Error('pricing unavailable')),
      estimate: () => Promise.reject(new Error('pricing unavailable')),
      formatMoney: () => '$1.00',
    };

    await renderPricingProbe(usagePricing);

    expect(await screen.findByRole('heading', {name: 'Pricing configured'})).toBeVisible();
    await act(async () => {
      await Promise.resolve();
    });
  });
});
