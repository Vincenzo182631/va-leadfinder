import { log } from '../lib/log';
import type { Config } from '../env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  tag: 'welcome' | 'billing' | 'digest' | 'account' | 'password_reset';
}

export interface EmailProvider {
  name: string;
  configured: boolean;
  send(msg: EmailMessage): Promise<{ ok: boolean; id?: string; error?: string }>;
}

/** Development: records messages in memory and logs a redacted line. Never delivers. */
export function consoleEmail(): EmailProvider & { outbox: EmailMessage[] } {
  const outbox: EmailMessage[] = [];
  return {
    name: 'console',
    configured: true,
    outbox,
    async send(msg) {
      outbox.push(msg);
      if (outbox.length > 200) outbox.shift();
      log('info', 'email.console', { tag: msg.tag, subject: msg.subject, to: msg.to });
      return { ok: true, id: `console_${outbox.length}` };
    },
  };
}

export function resendEmail(cfg: Config): EmailProvider {
  const configured = Boolean(cfg.TRANSACTIONAL_EMAIL_API_KEY && cfg.TRANSACTIONAL_EMAIL_FROM);
  return {
    name: 'resend',
    configured,
    async send(msg) {
      if (!configured) return { ok: false, error: 'email_not_configured' };
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.TRANSACTIONAL_EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: cfg.TRANSACTIONAL_EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, tags: [{ name: 'type', value: msg.tag }] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { ok: false, error: `resend_${res.status}` };
      const j = (await res.json()) as { id?: string };
      return { ok: true, id: j.id };
    },
  };
}

export function disabledEmail(): EmailProvider {
  return { name: 'disabled', configured: false, async send() { return { ok: false, error: 'email_disabled' }; } };
}

export function createEmail(cfg: Config): EmailProvider {
  if (cfg.TRANSACTIONAL_EMAIL_PROVIDER === 'resend') return resendEmail(cfg);
  if (cfg.TRANSACTIONAL_EMAIL_PROVIDER === 'disabled') return disabledEmail();
  return consoleEmail();
}
