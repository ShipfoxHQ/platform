import {
  ApplicationLayout,
  defineRoute,
  useLayoutNavigation,
} from '@shipfox/client-shell/runtime';

function ExternalAdminLayout() {
  const entries = useLayoutNavigation('fixture.admin-layout');
  return (
    <ApplicationLayout
      context={<span>External administration</span>}
      navigation={{ariaLabel: 'External administration sections', entries}}
    />
  );
}

export default defineRoute({
  staticData: {frame: 'content'},
  component: ExternalAdminLayout,
});
