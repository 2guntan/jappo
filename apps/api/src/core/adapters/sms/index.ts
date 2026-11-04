import Handlebars from 'handlebars';
import type { Env } from '../../../env';

/** SMS adapter (SPEC §13). */
export interface SmsAdapter {
  readonly code: string;
  send(to: string, text: string): Promise<{ providerRef: string }>;
}

/** Dev adapter: logs and keeps an in-memory log (also persisted via notifications rows). */
export class ConsoleSms implements SmsAdapter {
  readonly code = 'console';
  readonly sent: { to: string; text: string; at: Date }[] = [];
  async send(to: string, text: string) {
    this.sent.push({ to, text, at: new Date() });
    process.stdout.write(`${JSON.stringify({ level: 30, msg: 'sms.console', to, text })}\n`);
    return { providerRef: `console-${Date.now()}-${this.sent.length}` };
  }
}

/** Generic HTTP gateway: POST to SMS_HTTP_URL with a Handlebars body template. */
export class HttpGenericSms implements SmsAdapter {
  readonly code = 'http_generic';
  private tpl: HandlebarsTemplateDelegate;
  constructor(private env: Env) {
    this.tpl = Handlebars.compile(env.SMS_HTTP_BODY_TEMPLATE, { noEscape: true });
  }
  async send(to: string, text: string) {
    if (!this.env.SMS_HTTP_URL) throw new Error('SMS_HTTP_URL not configured');
    const body = this.tpl({ to, text: JSON.stringify(text).slice(1, -1) });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.env.SMS_HTTP_AUTH_HEADER) {
      const [k, ...v] = this.env.SMS_HTTP_AUTH_HEADER.split(':');
      if (k && v.length) headers[k.trim()] = v.join(':').trim();
    }
    const res = await fetch(this.env.SMS_HTTP_URL, { method: 'POST', headers, body });
    if (!res.ok) throw new Error(`SMS gateway HTTP ${res.status}`);
    const txt = await res.text();
    let ref = `http-${Date.now()}`;
    try {
      const j = JSON.parse(txt) as Record<string, unknown>;
      ref = String(j.id ?? j.messageId ?? j.reference ?? ref);
    } catch {
      /* non-JSON body */
    }
    return { providerRef: ref };
  }
}

export const createSms = (env: Env): SmsAdapter => (env.SMS_PROVIDER === 'http_generic' ? new HttpGenericSms(env) : new ConsoleSms());
