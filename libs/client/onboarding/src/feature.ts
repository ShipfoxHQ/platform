import {defineClientFeature} from '@shipfox/client-shell';

export const onboardingFeature = defineClientFeature({
  id: 'shipfox.onboarding',
});

export {WorkspaceSetupChecklist, WorkspaceSetupIndicator} from './components/setup-checklist.js';
