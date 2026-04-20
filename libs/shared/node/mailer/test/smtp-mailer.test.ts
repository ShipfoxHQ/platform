import nodemailer from 'nodemailer';
import {createSmtpMailer} from '#smtp-mailer.js';

describe('smtp mailer', () => {
  test('forwards the message to nodemailer transport', async () => {
    const sendMail = vi.fn().mockResolvedValue({messageId: '<test>'});
    const createTransportSpy = vi
      .spyOn(nodemailer, 'createTransport')
      // biome-ignore lint/suspicious/noExplicitAny: nodemailer transport type is heavy; cast for the test
      .mockReturnValue({sendMail} as any);

    const mailer = createSmtpMailer({
      host: 'smtp.example.com',
      port: 587,
      user: 'user',
      password: 'pass',
      from: 'noreply@shipfox.test',
    });

    await mailer.send({
      to: 'alice@example.com',
      subject: 'Welcome',
      text: 'Hello',
      html: '<p>Hello</p>',
    });

    expect(createTransportSpy).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {user: 'user', pass: 'pass'},
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'noreply@shipfox.test',
      to: 'alice@example.com',
      subject: 'Welcome',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
  });

  test('infers secure=true on port 465', () => {
    const createTransportSpy = vi
      .spyOn(nodemailer, 'createTransport')
      // biome-ignore lint/suspicious/noExplicitAny: nodemailer transport type is heavy; cast for the test
      .mockReturnValue({sendMail: vi.fn().mockResolvedValue({})} as any);

    createSmtpMailer({
      host: 'smtp.example.com',
      port: 465,
      from: 'noreply@shipfox.test',
    });

    expect(createTransportSpy).toHaveBeenCalledWith(
      expect.objectContaining({secure: true, auth: undefined}),
    );
  });
});
