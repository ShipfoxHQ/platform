import {defineRoute, useRouteSearch} from '@shipfox/client-shell/runtime';
import {HomeRouter} from '#pages/home-router.js';
import {validateProjectsSearch} from './search.js';

export default defineRoute({
  staticData: {frame: 'content'},
  validateSearch: validateProjectsSearch,
  component: () => <HomeRouter search={useRouteSearch(validateProjectsSearch)} />,
});
