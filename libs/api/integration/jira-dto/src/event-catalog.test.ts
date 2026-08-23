import {jiraEventCatalog, jiraWebhookEventNames} from './index.js';

describe('jiraEventCatalog', () => {
  it('lists exactly the event names the webhook handler accepts', () => {
    expect(jiraEventCatalog.events.map((event) => event.name)).toEqual([...jiraWebhookEventNames]);
  });
});
