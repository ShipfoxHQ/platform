// @vitest-environment jsdom
import {createMemoryHistory, createRootRoute, createRouter} from '@tanstack/react-router';
import {act, screen} from '@testing-library/react';
import {useEffect} from 'react';
import {defineClientFeature} from '#contract.js';
import {composeClientApp} from '#runtime/compose-client-app.js';
import {noopClientAnalytics, useClientAnalytics} from '#runtime/index.js';
import {renderComposedShell} from '#test/render.js';
import {defineRoute} from './define-route.js';

function AnalyticsProbe() {
  const analytics = useClientAnalytics();
  useEffect(() => {
    analytics.capture('probe_event', {source: 'probe'});
  }, [analytics]);
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

  test('contains failures from an injected implementation', async () => {
    const capture = vi.fn(() => {
      throw new Error('analytics unavailable');
    });
    await renderAnalyticsProbe({capture});

    expect(await screen.findByRole('heading', {name: 'Analytics probe'})).toBeVisible();
    expect(capture).toHaveBeenCalledWith('probe_event', {source: 'probe'});
  });

  test('wires injected analytics through composeClientApp', async () => {
    const capture = vi.fn();
    const element = await renderComposedApp({capture});

    expect(await screen.findByRole('heading', {name: 'Analytics probe'})).toBeVisible();
    expect(capture).toHaveBeenCalledWith('probe_event', {source: 'probe'});
    element.remove();
  });

  test('uses the no-op analytics implementation when composeClientApp receives none', async () => {
    const element = await renderComposedApp({});

    expect(await screen.findByRole('heading', {name: 'Analytics probe'})).toBeVisible();
    element.remove();
  });
});

async function renderComposedApp(options: {
  capture?: (event: string, properties?: Record<string, unknown>) => void;
}) {
  window.__SHIPFOX_CONFIG__ = {API_URL: 'https://api.example.test'};
  const element = document.createElement('div');
  document.body.append(element);
  const rootRoute = createRootRoute({component: AnalyticsProbe});
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/']}),
    routeTree: rootRoute,
  });
  const app = composeClientApp({
    features: [],
    router,
    ...(options.capture ? {clientAnalytics: {capture: options.capture}} : {}),
  });

  await act(async () => app.mount(element));
  return element;
}
