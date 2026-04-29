# Shipfox Mailer

Small mailer interface for Shipfox Node packages. It supports SMTP delivery for production and a console mailer for local development and tests.

## What it does

- **`Mailer`**: Interface with one `send(message)` method.
- **`MailMessage`**: Message shape with `to`, `subject`, `text`, and optional `html`.
- **`createConsoleMailer(options)`**: Logs mail through the Shipfox logger and can capture messages in an array.
- **`createSmtpMailer(options)`**: Sends mail through `nodemailer`.

## Usage

```ts
import {createConsoleMailer, createSmtpMailer, type Mailer} from '@shipfox/node-mailer';

const mailer: Mailer =
  process.env.MAILER_TRANSPORT === 'smtp'
    ? createSmtpMailer({
        host: 'smtp.example.com',
        port: 587,
        user: process.env.SMTP_USER,
        password: process.env.SMTP_PASSWORD,
        from: 'noreply@shipfox.local',
      })
    : createConsoleMailer({from: 'noreply@shipfox.local'});

await mailer.send({
  to: 'user@example.com',
  subject: 'Verify your email',
  text: 'Open this link to verify your email.',
});
```

## Notes

- SMTP uses `secure: true` by default on port `465`.
- SMTP auth is only sent when both `user` and `password` are set.
- The console mailer is useful in tests because `capture` stores each message.

## Development

```sh
turbo check --filter=@shipfox/node-mailer
turbo type --filter=@shipfox/node-mailer
turbo test --filter=@shipfox/node-mailer
```

## License

MIT
