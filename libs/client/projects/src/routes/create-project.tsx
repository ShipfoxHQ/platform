import {defineRoute} from '@shipfox/client-shell/runtime';
import {CreateProjectPage} from '#pages/create-project-page.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: CreateProjectPage,
});
