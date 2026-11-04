import nodemailer from 'nodemailer';
import type { Env } from '../../../env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer }[];
}

/** Email adapter (SPEC §13). */
export interface EmailAdapter {
  readonly code: string;
  send(msg: EmailMessage): Promise<{ providerRef: string }>;
}

export class SmtpEmail implements EmailAdapter {
  readonly code = 'smtp';
  private t: nodemailer.Transporter;
  constructor(private env: Env) {
    this.t = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  async send(msg: EmailMessage) {
    const r = await this.t.sendMail({ from: this.env.SMTP_FROM, ...msg });
    return { providerRef: r.messageId };
  }
}

/** In-memory transport for tests. */
export class MemoryEmail implements EmailAdapter {
  readonly code = 'memory';
  readonly outbox: EmailMessage[] = [];
  async send(msg: EmailMessage) {
    this.outbox.push(msg);
    return { providerRef: `mem-${this.outbox.length}` };
  }
}

export const createEmail = (env: Env): EmailAdapter => (env.EMAIL_TRANSPORT === 'memory' ? new MemoryEmail() : new SmtpEmail(env));
