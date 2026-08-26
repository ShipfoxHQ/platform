import {githubEventCatalog} from './index.js';

const githubWebhookPayloadDocsUrl =
  'https://docs.github.com/en/webhooks/webhook-events-and-payloads';

const expectedActionSummaries = {
  pull_request: {
    opened: 'A pull request opens.',
    closed: 'A pull request closes or merges.',
    synchronize: 'A pull request head branch receives commits.',
    reopened: 'A closed pull request reopens.',
    assigned: 'A pull request is assigned to a user.',
    unassigned: 'A user is unassigned from a pull request.',
    labeled: 'A label is added to a pull request.',
    unlabeled: 'A label is removed from a pull request.',
    edited: 'A pull request title, body, or branch changes.',
    converted_to_draft: 'A pull request is converted to draft.',
    locked: 'Conversation on a pull request is locked.',
    unlocked: 'Conversation on a pull request is unlocked.',
    enqueued: 'A pull request is added to the merge queue.',
    dequeued: 'A pull request is removed from the merge queue.',
    milestoned: 'A pull request is added to a milestone.',
    demilestoned: 'A pull request is removed from a milestone.',
    ready_for_review: 'A draft pull request is marked ready for review.',
    review_requested: 'A review is requested on a pull request.',
    review_request_removed: 'A pull request review request is removed.',
    auto_merge_enabled: 'Auto-merge is enabled for a pull request.',
    auto_merge_disabled: 'Auto-merge is disabled for a pull request.',
  },
  pull_request_review_comment: {
    created: 'A comment on a pull request diff is created.',
    edited: 'A comment on a pull request diff is edited.',
    deleted: 'A comment on a pull request diff is deleted.',
  },
  issues: {
    opened: 'An issue opens.',
    closed: 'An issue closes.',
    reopened: 'A closed issue reopens.',
    edited: 'An issue title or body changes.',
    labeled: 'A label is added to an issue.',
    unlabeled: 'A label is removed from an issue.',
    assigned: 'An issue is assigned to a user.',
    unassigned: 'A user is unassigned from an issue.',
    deleted: 'An issue is deleted.',
    transferred: 'An issue is transferred to another repository.',
    pinned: 'An issue is pinned.',
    unpinned: 'An issue is unpinned.',
    locked: 'Conversation on an issue is locked.',
    unlocked: 'Conversation on an issue is unlocked.',
    milestoned: 'An issue is added to a milestone.',
    demilestoned: 'An issue is removed from a milestone.',
    typed: 'An issue type is added to an issue.',
    untyped: 'An issue type is removed from an issue.',
    field_added: 'A field is added to an issue.',
    field_removed: 'A field is removed from an issue.',
  },
  release: {
    published: 'A release is published.',
    unpublished: 'A release is unpublished.',
    created: 'A draft release is created or saved.',
    edited: 'A release is edited.',
    deleted: 'A release is deleted.',
    prereleased: 'A release is published as a pre-release.',
    released: 'A release is published from a pre-release.',
  },
} as const;

const expectedEvents = [
  {
    name: 'push',
    summary: 'A Git reference receives one or more commits.',
    emittedWhen: 'GitHub sends a push webhook to the connected GitHub App.',
    payloadKind: 'raw-provider' as const,
    payloadDocUrl: githubWebhookPayloadDocsUrl,
  },
  ...Object.entries(expectedActionSummaries).flatMap(([family, actions]) =>
    Object.entries(actions).map(([action, summary]) => ({
      name: `${family}.${action}`,
      summary,
      emittedWhen: `GitHub sends a ${family} webhook with the ${action} action.`,
      payloadKind: 'raw-provider' as const,
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    })),
  ),
];

describe('githubEventCatalog', () => {
  it('lists every documented action with its complete event metadata', () => {
    expect(githubEventCatalog.events).toEqual(expectedEvents);
  });
});
