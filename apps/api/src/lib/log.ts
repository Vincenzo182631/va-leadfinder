/** Structured JSON logging with secret / PII redaction. */
const SENSITIVE = /authorization|password|secret|token|api[-_]?key|cookie|signature|email|phone|card/i;
const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /(bearer\s+)[A-Za-z0-9._-]+/gi;
const KEYLIKE = /\b(sk|pk|whsk)_(test|live)_[A-Za-z0-9]+/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth]';
  if (typeof value === 'string')
    return value.replace(EMAIL_IN_TEXT, '[email]').replace(BEARER, '$1[redacted]').replace(KEYLIKE, '[key]');
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
let silent = false;
export const setLogSilent = (v: boolean) => {
  silent = v;
};

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (silent && level !== 'error') return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields) as object) });
  if (level === 'error') console.error(line);
  else console.log(line);
}
