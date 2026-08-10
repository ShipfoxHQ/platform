import {defineRoute} from '@shipfox/client-shell/runtime';

export default defineRoute({
  staticData: {frame: 'content'},
  component: () => <h1>External administration overview</h1>,
});
