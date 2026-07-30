import Constants from 'expo-constants';
import i18n from '../i18n';
import { callOn401 } from './api.on401';

function resolveApiBaseUrl(): string {
  const url = Constants.expoConfig?.extra?.apiUrl;
  if (typeof url === 'string' && url.length > 0) return url;
  return 'http://localhost:3000';
}

export const API_BASE_URL = resolveApiBaseUrl();
const API_URL = API_BASE_URL;
const REQUEST_TIMEOUT_MS = 30000;

export async function apiFetch<T>(
  path: string,
  options?: RequestInit & { token?: string }
): Promise<T> {
  const { token, ...init } = options || {};
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(i18n.t('api.requestTimeout'));
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
  if (res.status === 401 && token) {
    callOn401();
  }
  if (!res.ok) {
    const raw = await res.text();
    let msg: string = raw || `API error: ${res.status}`;
    let resendAvailableAt: string | undefined;
    try {
      const parsed = JSON.parse(raw) as { message?: unknown; resendAvailableAt?: string };
      if (typeof parsed?.resendAvailableAt === 'string') {
        resendAvailableAt = parsed.resendAvailableAt;
      }
      if (parsed?.message != null) {
        const m = parsed.message;
        if (typeof m === 'string') msg = m;
        else if (Array.isArray(m))
          msg = m.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ');
        else msg = String(m);
      }
    } catch {
      /* use raw */
    }
    const err = new Error(msg) as Error & { resendAvailableAt?: string; httpStatus?: number };
    if (resendAvailableAt) err.resendAvailableAt = resendAvailableAt;
    err.httpStatus = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** Authenticated GET returning raw bytes (e.g. PDF). */
export async function apiFetchBinary(
  path: string,
  options?: RequestInit & { token?: string }
): Promise<ArrayBuffer> {
  const { token, ...init } = options || {};
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      method: init?.method ?? 'GET',
      headers,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(i18n.t('api.requestTimeout'));
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
  if (res.status === 401 && token) {
    callOn401();
  }
  if (!res.ok) {
    const raw = await res.text();
    let msg: string = raw || `API error: ${res.status}`;
    try {
      const parsed = JSON.parse(raw) as { message?: unknown };
      if (parsed?.message != null) {
        const m = parsed.message;
        if (typeof m === 'string') msg = m;
        else if (Array.isArray(m))
          msg = m.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ');
        else msg = String(m);
      }
    } catch {
      /* use raw */
    }
    const err = new Error(msg) as Error & { httpStatus?: number };
    err.httpStatus = res.status;
    throw err;
  }
  return res.arrayBuffer();
}
