import {logger} from '@shipfox/node-opentelemetry';
import type {Mailer, MailMessage} from './mailer.js';

export interface ConsoleMailerOptions {
  from: string;
  capture?: MailMessage[];
}

export function createConsoleMailer(options: ConsoleMailerOptions): Mailer {
  const {from, capture} = options;
  return {
    send: (message) => {
      capture?.push(message);
      logger().info(
        {
          mailer: 'console',
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
        'mailer.send',
      );
      return Promise.resolve();
    },
  };
}
