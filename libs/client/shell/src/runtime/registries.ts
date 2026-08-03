import {normalizeRoutePath} from '#compose/normalize-route-path.js';
import type {
  ClientFeature,
  LayoutNavigationEntry,
  NavTabEntry,
  SettingsSectionEntry,
} from '#contract.js';

interface Ordered<T> {
  entry: T;
  featureIndex: number;
  declarationIndex: number;
}

function byOrder<T extends {order?: number}>(left: Ordered<T>, right: Ordered<T>): number {
  return (
    (left.entry.order ?? 500) - (right.entry.order ?? 500) ||
    left.featureIndex - right.featureIndex ||
    left.declarationIndex - right.declarationIndex
  );
}

export function navigationEntries(features: readonly ClientFeature[]): NavTabEntry[] {
  return features
    .flatMap((feature, featureIndex) =>
      (feature.navigation ?? []).map((entry, declarationIndex) => ({
        entry,
        featureIndex,
        declarationIndex,
      })),
    )
    .sort(byOrder)
    .map(({entry}) => ({...entry, to: normalizeRoutePath(entry.to)}));
}

export function layoutNavigationRegistry(
  features: readonly ClientFeature[],
): ReadonlyMap<string, readonly LayoutNavigationEntry[]> {
  const registry = new Map<string, LayoutNavigationEntry[]>();
  for (const entry of navigationEntries(features)) {
    if (entry.scope !== 'layout') continue;
    const entries = registry.get(entry.layout) ?? [];
    entries.push(entry);
    registry.set(entry.layout, entries);
  }
  return registry;
}

export function settingsEntries(features: readonly ClientFeature[]): SettingsSectionEntry[] {
  return features
    .flatMap((feature, featureIndex) =>
      (feature.settingsSections ?? []).map((entry, declarationIndex) => ({
        entry,
        featureIndex,
        declarationIndex,
      })),
    )
    .sort(byOrder)
    .map(({entry}) => ({...entry, scope: entry.scope ?? 'workspace'}));
}
