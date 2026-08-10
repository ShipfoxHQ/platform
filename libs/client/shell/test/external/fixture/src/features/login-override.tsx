import {defineRoute} from '@shipfox/client-shell/runtime';

function ExternalLogin() {
  return <h1>External login</h1>;
}

const route = defineRoute({staticData: {frame: 'focused'}, component: ExternalLogin});

export default route;
