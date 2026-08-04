import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {jiraWebhookEventNames} from '@shipfox/api-integration-jira-dto';
import {linearWebhookEventNames} from '@shipfox/api-integration-linear-dto';
import {WEBHOOK_RECEIVED_EVENT} from '@shipfox/api-integration-webhook-dto';
import {usageEventsForConnection} from './integration-usage-events.js';

const baseConnection = {
  id: '44444444-4444-4444-8444-444444444444',
  workspace_id: '11111111-1111-4111-8111-111111111111',
  provider: 'github',
  external_account_id: 'installation-1',
  slug: 'github_acme_corp',
  display_name: 'acme-corp',
  lifecycle_status: 'active',
  capabilities: [],
  created_at: '2026-03-12T00:00:00.000Z',
  updated_at: '2026-03-12T00:00:00.000Z',
} satisfies IntegrationConnectionDto;

describe('usageEventsForConnection', () => {
  it('lists the GitHub webhook events used by workflow triggers', () => {
    const connection = {
      ...baseConnection,
      provider: 'github',
      capabilities: ['source_control'],
    } satisfies IntegrationConnectionDto;

    const events = usageEventsForConnection(connection);
    const values = events.map((event) => event.value);

    expect(values[0]).toBe('push');
    expect(values).toEqual(expect.arrayContaining(['pull_request', 'workflow_run']));
    expect(events.find((event) => event.value === 'workflow_run')?.label).toBe('workflow_run');
  });

  it('uses the webhook received event for webhook connections', () => {
    const connection = {
      ...baseConnection,
      provider: 'webhook',
      slug: 'stripe-prod',
    } satisfies IntegrationConnectionDto;

    const events = usageEventsForConnection(connection);

    expect(events).toEqual([{value: WEBHOOK_RECEIVED_EVENT, label: WEBHOOK_RECEIVED_EVENT}]);
  });

  it('uses source-control push for uncataloged source-control providers', () => {
    const connection = {
      ...baseConnection,
      provider: 'gitea',
      capabilities: ['source_control'],
    } satisfies IntegrationConnectionDto;

    const events = usageEventsForConnection(connection);

    expect(events).toEqual([{value: 'push', label: 'push'}]);
  });

  it('uses Linear webhook names directly', () => {
    const connection = {
      ...baseConnection,
      provider: 'linear',
    } satisfies IntegrationConnectionDto;

    const events = usageEventsForConnection(connection);

    expect(events.map((event) => event.value)).toEqual(linearWebhookEventNames);
  });

  it('uses Jira webhook names directly', () => {
    const connection = {
      ...baseConnection,
      provider: 'jira',
      capabilities: ['agent_tools'],
    } satisfies IntegrationConnectionDto;

    const events = usageEventsForConnection(connection);

    expect(events.map((event) => event.value)).toEqual(jiraWebhookEventNames);
  });

  it('falls back to a generic received event for uncataloged providers', () => {
    const connection = {
      ...baseConnection,
      provider: 'mystery',
    } satisfies IntegrationConnectionDto;

    const events = usageEventsForConnection(connection);

    expect(events).toEqual([{value: 'received', label: 'received'}]);
  });
});
