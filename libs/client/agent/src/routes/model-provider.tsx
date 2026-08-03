import {defineRoute, useActiveWorkspace, useRouteParams} from '@shipfox/client-shell/runtime';
import {useNavigate} from '@tanstack/react-router';
import {ModelProviderOnboardingPage} from '#pages/model-provider-onboarding-page.js';
import {modelProviderRouteParams} from './inputs.js';

export default defineRoute({
  component: () => {
    const {workspaceSlug} = useRouteParams(modelProviderRouteParams);
    const workspace = useActiveWorkspace();
    const navigate = useNavigate();
    const goToProjectCreation = () => {
      void navigate({to: '/w/$workspaceSlug/projects/new', params: {workspaceSlug}, replace: true});
    };
    return (
      <ModelProviderOnboardingPage
        workspaceId={workspace.id}
        onSkip={goToProjectCreation}
        onConfigured={goToProjectCreation}
      />
    );
  },
});
