import {defineRoute} from '@shipfox/client-shell/runtime';
import {Header} from '@shipfox/react-ui/typography';
import {IntegrationGallery} from '#index.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: () => (
    <div className="flex min-w-0 flex-col gap-section">
      <Header variant="h1">Integrations</Header>
      <IntegrationGallery />
    </div>
  ),
});
