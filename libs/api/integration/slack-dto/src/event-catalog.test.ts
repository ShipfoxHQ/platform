import {slackEventCatalog, slackEventNames} from './index.js';

describe('slackEventCatalog', () => {
  it('lists exactly the event names the webhook handler accepts', () => {
    expect(slackEventCatalog.events.map((event) => event.name)).toEqual([...slackEventNames]);
  });
});
