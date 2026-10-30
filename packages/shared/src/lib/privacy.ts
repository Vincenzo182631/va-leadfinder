/**
 * Data-minimisation guards. The MVP stores company-level signals only:
 * no personal names, personal emails or phone numbers of individuals.
 */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Loose phone pattern: 10+ digits with common separators.
const PHONE_RE = /\+?\d(?:[\s().-]{0,3}\d){9,14}/g;

/** Role-based mailbox prefixes we treat as a generic business contact route. */
export const GENERIC_MAILBOXES = [
  'info', 'hello', 'contact', 'careers', 'jobs', 'hiring', 'hr', 'support', 'team', 'admin',
  'office', 'work', 'apply', 'recruiting', 'talent', 'partners', 'sales', 'help',
];

export function isGenericBusinessEmail(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return GENERIC_MAILBOXES.includes(local.replace(/[^a-z]/g, ''));
}

export interface PersonalDataFinding {
  field: string;
  kind: 'personal_email' | 'phone_number';
}

/** Scan free-text fields for personal contact data that we must not store. */
export function findPersonalData(fields: Record<string, string | undefined | null>): PersonalDataFinding[] {
  const out: PersonalDataFinding[] = [];
  for (const [field, raw] of Object.entries(fields)) {
    if (!raw) continue;
    for (const m of raw.match(EMAIL_RE) ?? []) {
      if (!isGenericBusinessEmail(m)) out.push({ field, kind: 'personal_email' });
    }
    if (PHONE_RE.test(raw)) out.push({ field, kind: 'phone_number' });
    PHONE_RE.lastIndex = 0;
  }
  return out;
}

/**
 * Contact route must be a company URL (e.g. careers/contact page) or a generic
 * role mailbox. Returns a normalised value or null when not acceptable.
 */
export function normalizeContactRoute(route: string): { ok: true; value: string } | { ok: false; reason: string } {
  const v = route.trim();
  if (!v) return { ok: true, value: '' };
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'Unsupported URL scheme' };
      return { ok: true, value: u.toString() };
    } catch {
      return { ok: false, reason: 'Invalid URL' };
    }
  }
  const m = v.match(/^mailto:(.+)$/i);
  const email = (m ? m[1] : v)!.trim();
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) {
    return isGenericBusinessEmail(email)
      ? { ok: true, value: email.toLowerCase() }
      : { ok: false, reason: 'Only generic business mailboxes (e.g. careers@, hello@) are allowed' };
  }
  return { ok: false, reason: 'Contact route must be a URL or a generic business mailbox' };
}
