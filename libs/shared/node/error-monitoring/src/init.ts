import * as Sentry from '@sentry/node';
import {config} from './config.js';

const image = config.SENTRY_IMAGE;
const [imageName, imageTag] = image?.split(':') ?? [];
const release = imageTag?.split('-')[0];

Sentry.init({
  dsn: config.SENTRY_DSN,
  environment: config.SENTRY_ENVIRONMENT,
  release,
  skipOpenTelemetrySetup: true,
});

Sentry.setTag('image', image);
Sentry.setTag('image-name', imageName);
Sentry.setTag('image-tag', imageTag);
