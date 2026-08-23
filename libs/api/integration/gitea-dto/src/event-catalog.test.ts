import {giteaEventCatalog} from './index.js';

describe('giteaEventCatalog', () => {
  it('lists exactly the push event the webhook handler accepts and publishes', () => {
    expect(giteaEventCatalog.events.map((event) => event.name)).toEqual(['push']);
  });
});
