import {defineRoute} from '@shipfox/client-shell/runtime';

export default defineRoute({
  staticData: {frame: 'content'},
  component: () => <div>Named route</div>,
});
