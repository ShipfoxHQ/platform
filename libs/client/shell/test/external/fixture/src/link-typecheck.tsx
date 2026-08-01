import {Link, useParams} from '@tanstack/react-router';

export function ExternalSettingsLink() {
  const params = useParams({from: '/w/$workspaceSlug/settings/external'});
  return (
    <Link to="/w/$workspaceSlug/settings/external" params={{workspaceSlug: params.workspaceSlug}}>
      External settings
    </Link>
  );
}
