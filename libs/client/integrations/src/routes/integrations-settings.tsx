import {defineRoute} from '@shipfox/client-shell/runtime';
import {IntegrationGallery} from '#index.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: IntegrationGallery,
});
