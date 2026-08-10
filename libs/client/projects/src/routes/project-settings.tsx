import {defineRoute} from '@shipfox/client-shell/runtime';
import {ProjectSettingsPage} from '#pages/project-settings-page.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: ProjectSettingsPage,
});
