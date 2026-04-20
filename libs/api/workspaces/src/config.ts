import {createConfig, num, str} from '@shipfox/config';
import {createConsoleMailer, createSmtpMailer, type Mailer} from '@shipfox/node-mailer';

export const config = createConfig({
  CLIENT_BASE_URL: str({default: 'http://localhost:3000'}),
  MAILER_TRANSPORT: str({default: 'console'}),
  MAILER_FROM: str({default: 'noreply@shipfox.local'}),
  SMTP_HOST: str({default: undefined}),
  SMTP_PORT: num({default: 587}),
  SMTP_USER: str({default: undefined}),
  SMTP_PASSWORD: str({default: undefined}),
});

function createMailer(): Mailer {
  if (config.MAILER_TRANSPORT === 'smtp') {
    if (!config.SMTP_HOST) throw new Error('SMTP_HOST is required when MAILER_TRANSPORT=smtp');
    return createSmtpMailer({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      ...(config.SMTP_USER ? {user: config.SMTP_USER} : {}),
      ...(config.SMTP_PASSWORD ? {password: config.SMTP_PASSWORD} : {}),
      from: config.MAILER_FROM,
    });
  }

  return createConsoleMailer({from: config.MAILER_FROM});
}

export const mailer = createMailer();
