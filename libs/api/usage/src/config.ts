import {createConfig, num} from '@shipfox/config';

export const config = createConfig({
  USAGE_RETENTION_DAYS: num({
    desc: 'How many days Usage records are kept before the daily retention cron drops their whole monthly partitions. Must be a whole number of days, 1 or greater. Defaults to 400 days.',
    default: 400,
  }),
});

if (!Number.isInteger(config.USAGE_RETENTION_DAYS) || config.USAGE_RETENTION_DAYS < 1) {
  throw new Error(
    `USAGE_RETENTION_DAYS (${config.USAGE_RETENTION_DAYS}) must be a whole number of days >= 1.`,
  );
}
