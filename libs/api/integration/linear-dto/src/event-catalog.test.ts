import {linearEventCatalog, linearWebhookEventNames} from './index.js';

describe('linearEventCatalog', () => {
  it('lists exactly the event names the webhook handler accepts', () => {
    expect(linearEventCatalog.events.map((event) => event.name)).toEqual([
      ...linearWebhookEventNames,
    ]);
  });

  it('covers every supported resource type and action pair', () => {
    const names = linearEventCatalog.events.map((event) => event.name);
    for (const name of [
      'Issue.create',
      'IssueLabel.update',
      'Cycle.remove',
      'agentSession.created',
    ])
      expect(names).toContain(name);
  });
});
