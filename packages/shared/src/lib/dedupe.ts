/** Normalise text for duplicate detection. */
export function normalizeForKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeUrlForKey(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    for (const p of [...url.searchParams.keys()]) if (/^utm_|^ref$|^source$/i.test(p)) url.searchParams.delete(p);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}${url.search}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

/** Stable dedupe key: provider external id when present, otherwise company+role+source url. */
export function dedupeKeyMaterial(p: {
  providerKey: string;
  externalId?: string | null;
  companyName: string;
  title: string;
  sourceUrl: string;
}): string {
  if (p.externalId) return `${p.providerKey}|ext|${p.externalId.trim()}`;
  return `${p.providerKey}|h|${normalizeForKey(p.companyName)}|${normalizeForKey(p.title)}|${normalizeUrlForKey(p.sourceUrl)}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function dedupeKey(p: Parameters<typeof dedupeKeyMaterial>[0]): Promise<string> {
  return sha256Hex(dedupeKeyMaterial(p));
}
