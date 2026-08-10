import {defineRoute} from '@shipfox/client-shell/runtime';
import {SourceControlOnboardingPage} from '#pages/source-control-onboarding-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  component: SourceControlOnboardingPage,
});
