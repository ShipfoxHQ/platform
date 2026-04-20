import nodemailer from 'nodemailer';
import type {Mailer} from './mailer.js';

export interface SmtpMailerOptions {
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  password?: string;
  from: string;
}

export function createSmtpMailer(options: SmtpMailerOptions): Mailer {
  const {host, port, secure, user, password, from} = options;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: secure ?? port === 465,
    auth: user && password ? {user, pass: password} : undefined,
  });

  return {
    send: async (message) => {
      await transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}
