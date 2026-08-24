import {defineClientFeature} from '@shipfox/client-shell';
import {lazy} from 'react';

export const onboardingFeature = defineClientFeature({
  id: 'shipfox.onboarding',
});

export const WorkspaceSetupChecklist = lazy(async () => {
  const module = await import('./components/setup-checklist.js');
  return {default: module.WorkspaceSetupChecklist};
});

export const WorkspaceSetupIndicator = lazy(async () => {
  const module = await import('./components/setup-checklist.js');
  return {default: module.WorkspaceSetupIndicator};
});
