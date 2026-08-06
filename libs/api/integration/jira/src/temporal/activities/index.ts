import {
  type CreateJiraMaintenanceActivitiesOptions as CreateJiraTokenMaintenanceActivitiesOptions,
  createJiraMaintenanceActivities as createJiraTokenMaintenanceActivities,
  type JiraTokenRefreshActivityResult,
} from './refresh-jira-tokens.js';
import {
  type CreateJiraWebhookRenewalActivitiesOptions,
  createJiraWebhookRenewalActivities,
  type JiraWebhookRenewalActivityResult,
} from './renew-jira-webhooks.js';

export type CreateJiraMaintenanceActivitiesOptions = CreateJiraTokenMaintenanceActivitiesOptions &
  CreateJiraWebhookRenewalActivitiesOptions;

export function createJiraMaintenanceActivities(options: CreateJiraMaintenanceActivitiesOptions) {
  return {
    ...createJiraTokenMaintenanceActivities(options),
    ...createJiraWebhookRenewalActivities(options),
  };
}

export type {JiraTokenRefreshActivityResult, JiraWebhookRenewalActivityResult};
