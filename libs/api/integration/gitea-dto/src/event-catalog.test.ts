import {giteaEventCatalog, giteaWebhookEventNames} from './index.js';

describe('giteaEventCatalog', () => {
  it('lists exactly the event names the webhook handler accepts', () => {
    expect(giteaEventCatalog.events.map((event) => event.name)).toEqual([
      ...giteaWebhookEventNames,
    ]);
  });
});
