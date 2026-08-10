import {getLoadedConfig} from '@shipfox/client-config';
import {defineRoute} from '@shipfox/client-shell/runtime';
import {useProviderOrder} from '../provider';

function ExternalSettings() {
  const providerOrder = useProviderOrder();
  const config = getLoadedConfig<{externalGreeting: string}>();
  return (
    <section>
      <h1>External settings</h1>
      <p>{config.externalGreeting}</p>
      <output aria-label="External provider order">{providerOrder.join(' > ')}</output>
    </section>
  );
}

const route = defineRoute({staticData: {frame: 'content'}, component: ExternalSettings});

export default route;
