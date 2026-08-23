// @vitest-environment jsdom
import {screen} from '@testing-library/react';
import {defineClientFeature} from '#contract.js';
import {noopClientAnalytics, useClientAnalytics} from '#runtime/index.js';
import {renderComposedShell} from '#test/render.js';
import {defineRoute} from './define-route.js';

function AnalyticsProbe() {
  const analytics = useClientAnalytics();
  analytics.capture('probe_event', {source: 'probe'});
  return <h1>Analytics probe</h1>;
}

function analyticsFeature() {
  return defineClientFeature({
    id: 'acme.analytics',
    routes: [{path: '/w/$workspaceSlug/analytics', parent: 'workspaceLayout', impl: 'analytics'}],
  });
}

async function renderAnalyticsProbe(options: {
  capture?: (event: string, properties?: Record<string, unknown>) => void;
}) {
  await renderComposedShell({
    features: [analyticsFeature()],
    initialPath: '/w/workspace/analytics',
    resolveImpl: () => defineRoute({staticData: {frame: 'content'}, component: AnalyticsProbe}),
    ...(options.capture ? {clientAnalytics: {capture: options.capture}} : {}),
  });
}

describe('ClientAnalytics', () => {
  test('no-op default never throws and discards events', async () => {
    expect(() => noopClientAnalytics.capture('event', {key: 'value'})).not.toThrow();

    await renderAnalyticsProbe({});

    expect(await screen.findByRole('heading', {name: 'Analytics probe'})).toBeVisible();
  });

  test('reaches a composed implementation with event and properties', async () => {
    const capture = vi.fn();
    await renderAnalyticsProbe({capture});

    expect(await screen.findByRole('heading', {name: 'Analytics probe'})).toBeVisible();
    expect(capture).toHaveBeenCalledWith('probe_event', {source: 'probe'});
  });
});
