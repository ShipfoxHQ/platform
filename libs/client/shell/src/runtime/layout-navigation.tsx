import type {PropsWithChildren} from 'react';
import {createContext, useContext, useMemo} from 'react';
import type {ClientFeature, LayoutNavigationEntry} from '#contract.js';
import {layoutNavigationRegistry} from './registries.js';

type LayoutNavigationRegistry = ReadonlyMap<string, readonly LayoutNavigationEntry[]>;

const LayoutNavigationContext = createContext<LayoutNavigationRegistry>(new Map());

export function LayoutNavigationProvider({
  features,
  children,
}: PropsWithChildren<{features: readonly ClientFeature[]}>) {
  const registry = useMemo(() => layoutNavigationRegistry(features), [features]);
  return (
    <LayoutNavigationContext.Provider value={registry}>{children}</LayoutNavigationContext.Provider>
  );
}

export function useLayoutNavigation(layoutId: string): readonly LayoutNavigationEntry[] {
  return useContext(LayoutNavigationContext).get(layoutId) ?? [];
}
