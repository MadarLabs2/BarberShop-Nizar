import { apiFetch } from './api';

export async function registerPushToken(
  authToken: string,
  expoPushToken: string,
  platform: string,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/notifications/push-token', {
    method: 'POST',
    token: authToken,
    body: JSON.stringify({ expoPushToken, platform }),
  });
}

export async function deletePushToken(
  authToken: string,
  expoPushToken?: string,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/notifications/push-token', {
    method: 'DELETE',
    token: authToken,
    body: JSON.stringify(expoPushToken ? { expoPushToken } : {}),
  });
}
