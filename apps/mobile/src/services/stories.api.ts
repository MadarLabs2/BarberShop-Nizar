import { API_BASE_URL, apiFetch } from './api';
import { callOn401 } from './api.on401';

export type HomeStoryItem = {
  id: string;
  imageUrl: string;
  createdAt: string;
  viewsCount?: number;
};

export type HomeStoryAuthor = {
  authorKey: string;
  kind: 'salon' | 'staff';
  displayName: string;
  avatarUrl: string | null;
  stories: HomeStoryItem[];
};

export async function fetchHomeStories(): Promise<{ authors: HomeStoryAuthor[] }> {
  return apiFetch<{ authors: HomeStoryAuthor[] }>('/catalog/home-stories');
}

export async function markHomeStoryViewed(
  id: string,
  options?: { token?: string | null; viewerKey?: string | null },
): Promise<{ ok: boolean; viewsCount: number }> {
  const token = options?.token || undefined;
  const viewerKey = (options?.viewerKey || '').trim();
  return apiFetch<{ ok: boolean; viewsCount: number }>(`/catalog/home-stories/${id}/view`, {
    method: 'POST',
    token,
    headers: viewerKey ? { 'X-Story-Viewer-Key': viewerKey } : undefined,
  });
}

export type AdminStoryRow = HomeStoryItem & { staffId: string | null; authorLabel: string };

export async function fetchAdminHomeStories(token: string): Promise<AdminStoryRow[]> {
  return apiFetch<AdminStoryRow[]>('/admin/home-stories', { token });
}

export async function fetchMyHomeStories(token: string): Promise<HomeStoryItem[]> {
  return apiFetch<HomeStoryItem[]>('/admin/my-home-stories', { token });
}

export async function deleteAdminHomeStory(token: string, id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/admin/home-stories/${id}`, { method: 'DELETE', token });
}

export async function deleteMyHomeStory(token: string, id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/admin/my-home-stories/${id}`, { method: 'DELETE', token });
}

async function postStoryMultipart(
  token: string,
  path: string,
  localUri: string,
  mimeType?: string | null,
): Promise<HomeStoryItem> {
  const nameFromUri = localUri.split('/').pop() || 'story.jpg';
  const ext = nameFromUri.includes('.') ? nameFromUri.split('.').pop()?.toLowerCase() : undefined;
  const mime =
    mimeType ||
    (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg');
  const form = new FormData();
  form.append('file', {
    uri: localUri,
    name: nameFromUri.includes('.') ? nameFromUri : `upload.${ext === 'png' || ext === 'webp' || ext === 'gif' ? ext : 'jpg'}`,
    type: mime,
  } as unknown as Blob);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: controller.signal,
    } as unknown as RequestInit);
    if (res.status === 401 && token) callOn401();
    if (!res.ok) {
      const raw = await res.text();
      let msg = raw || `Upload failed: ${res.status}`;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.message) msg = Array.isArray(parsed.message) ? parsed.message.join(', ') : String(parsed.message);
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return (await res.json()) as HomeStoryItem;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function uploadSalonHomeStory(token: string, localUri: string, mimeType?: string | null) {
  return postStoryMultipart(token, '/admin/home-stories', localUri, mimeType);
}

export function uploadStaffHomeStory(token: string, localUri: string, mimeType?: string | null) {
  return postStoryMultipart(token, '/admin/my-home-stories', localUri, mimeType);
}
