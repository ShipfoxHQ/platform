import {createConsoleMailer} from '#console-mailer.js';
import type {MailMessage} from '#mailer.js';

describe('console mailer', () => {
  test('captures sent messages when capture array is provided', async () => {
    const capture: MailMessage[] = [];
    const mailer = createConsoleMailer({from: 'noreply@shipfox.test', capture});

    await mailer.send({
      to: 'alice@example.com',
      subject: 'Welcome',
      text: 'Hello Alice',
      html: '<p>Hello Alice</p>',
    });

    expect(capture).toHaveLength(1);
    expect(capture[0]).toEqual({
      to: 'alice@example.com',
      subject: 'Welcome',
      text: 'Hello Alice',
      html: '<p>Hello Alice</p>',
    });
  });

  test('resolves successfully without capture array', async () => {
    const mailer = createConsoleMailer({from: 'noreply@shipfox.test'});

    await expect(
      mailer.send({to: 'alice@example.com', subject: 'Hi', text: 'Hi'}),
    ).resolves.toBeUndefined();
  });
});
