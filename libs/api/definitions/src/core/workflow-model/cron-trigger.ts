import {CronExpressionParser} from 'cron-parser';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

export const cronTriggerDefaultTimezone = 'UTC';
const cronFieldSeparatorRegex = /\s+/;

export function validateCronTrigger(params: {
  readonly sourceKey: string;
  readonly trigger: {
    readonly event?: string | undefined;
  };
  readonly config: {
    readonly schedule?: string | undefined;
    readonly timezone?: string | undefined;
  };
  readonly issues: WorkflowModelValidationIssue[];
}): void {
  const {sourceKey, trigger, config, issues} = params;

  if (trigger.event !== undefined && trigger.event !== 'tick') {
    issues.push(
      issue({
        code: 'invalid-cron-event',
        message: `A cron trigger must use event "tick"; found "${trigger.event}".`,
        path: ['triggers', sourceKey, 'event'],
        details: {event: trigger.event},
        scope: 'trigger',
      }),
    );
  }

  if (config.schedule === undefined) {
    issues.push(
      issue({
        code: 'missing-cron-schedule',
        message: 'A cron trigger requires a schedule.',
        path: ['triggers', sourceKey, 'config', 'schedule'],
        scope: 'trigger',
      }),
    );
  } else if (!isValidCronExpression(config.schedule)) {
    issues.push(
      issue({
        code: 'invalid-cron-schedule',
        message: 'Cron trigger schedule must be a valid 5-field cron expression.',
        path: ['triggers', sourceKey, 'config', 'schedule'],
        details: {schedule: config.schedule},
        scope: 'trigger',
      }),
    );
  }

  if (config.timezone !== undefined && !isValidTimezone(config.timezone)) {
    issues.push(
      issue({
        code: 'invalid-cron-timezone',
        message: 'Cron trigger timezone must be a valid IANA time zone.',
        path: ['triggers', sourceKey, 'config', 'timezone'],
        details: {timezone: config.timezone},
        scope: 'trigger',
      }),
    );
  }
}

export function isValidCronExpression(expression: string): boolean {
  const trimmedExpression = expression.trim();
  if (trimmedExpression.length === 0) return false;
  if (trimmedExpression.split(cronFieldSeparatorRegex).length !== 5) return false;

  try {
    CronExpressionParser.parse(trimmedExpression);
    return true;
  } catch {
    return false;
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: timezone});
    return true;
  } catch {
    return false;
  }
}
