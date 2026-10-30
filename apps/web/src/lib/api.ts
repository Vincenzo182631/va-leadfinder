import type { ApiErrorBody } from '@vlf/shared';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public requestId?: string) {
    super(message);
  }
}

let tokenGetter: () => Promise<string | null> = async () => null;
export const setTokenGetter = (fn: () => Promise<string | null>) => {
  tokenGetter = fn;
};

export async function api<T>(path: string, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
  const token = await tokenGetter();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection and try again.');
  }
  if (init.raw) {
    if (!res.ok) throw await toError(res);
    return res as unknown as T;
  }
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

async function toError(res: Response) {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return new ApiError(res.status, body.error?.code ?? 'http_error', body.error?.message ?? `Request failed (${res.status})`, body.error?.details, body.error?.requestId);
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export async function downloadFile(path: string, filename: string, method = 'GET') {
  const res = await api<Response>(path, { raw: true, method });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
