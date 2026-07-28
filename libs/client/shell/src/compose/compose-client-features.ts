import type {ClientFeature, NavTabEntry, SettingsSectionEntry} from '#contract.js';
import {navigationEntries, settingsEntries} from '#runtime/registries.js';
import {
  type ComposedLayout,
  type ComposedRoute,
  composeLayouts,
  composeRoutes,
} from './compose-routes.js';
import {mergeConfigShapes} from './merge-config.js';
import {validateProviderIds} from './validate-providers.js';
import {validateNavigation, validateSettingsSections} from './validate-registries.js';

export interface ComposedClientFeatures {
  configShape: ReturnType<typeof mergeConfigShapes>;
  layouts: ComposedLayout[];
  navigation: NavTabEntry[];
  routes: ComposedRoute[];
  settingsSections: SettingsSectionEntry[];
}

export function composeClientFeatures(features: readonly ClientFeature[]): ComposedClientFeatures {
  const layouts = composeLayouts(features);
  const routes = composeRoutes(features, layouts);
  validateProviderIds(features);
  validateNavigation(features, routes, layouts);
  validateSettingsSections(features, routes);

  return {
    configShape: mergeConfigShapes(features),
    layouts,
    navigation: navigationEntries(features),
    routes,
    settingsSections: settingsEntries(features),
  };
}
