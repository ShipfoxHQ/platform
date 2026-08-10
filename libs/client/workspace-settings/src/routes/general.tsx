import {defineRoute} from '@shipfox/client-shell/runtime';
import {GeneralSettingsPage} from '#pages/general-settings-page.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: GeneralSettingsPage,
});
