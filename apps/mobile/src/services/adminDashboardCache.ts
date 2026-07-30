import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DashboardSummary } from './admin.api';

export type AdminDashboardUpdateRow = {
  id: string;
  clientName: string;
  serviceName: string;
  staffName: string;
  date: string;
  time: string;
};

export type AdminDashboardSnapshot = {
  summary: DashboardSummary;
  updatesFeed: AdminDashboardUpdateRow[];
  staffList: { id: string; name: string }[];
};

const STORAGE_PREFIX = 'admin_dashboard_v1_t_';

function storageKey(token: string): string {
  let h = 0;
  for (let i = 0; i < token.length; i += 1) {
    h = (h << 5) - h + token.charCodeAt(i);
    h |= 0;
  }
  return `${STORAGE_PREFIX}${Math.abs(h).toString(36)}`;
}

let memory: { token: string; data: AdminDashboardSnapshot; at: number } | null = null;

/** In-memory TTL — disk restore still fills memory for cold start. */
const MEMORY_TTL_MS = 20 * 60_000;

export function peekAdminDashboard(token: string | null): AdminDashboardSnapshot | null {
  if (!token) return null;
  if (!memory || memory.token !== token) return null;
  if (Date.now() - memory.at > MEMORY_TTL_MS) {
    memory = null;
    return null;
  }
  return memory.data;
}

export function setAdminDashboardCache(token: string, data: AdminDashboardSnapshot): void {
  memory = { token, data, at: Date.now() };
  const payload = JSON.stringify({ ...data, at: Date.now() });
  void AsyncStorage.setItem(storageKey(token), payload).catch(() => {});
}

export async function restoreAdminDashboardCache(token: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(token));
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      summary?: DashboardSummary;
      updatesFeed?: AdminDashboardUpdateRow[];
      staffList?: { id: string; name: string }[];
      at?: number;
    };
    if (!parsed?.summary || !Array.isArray(parsed.updatesFeed) || !Array.isArray(parsed.staffList)) {
      return;
    }
    memory = {
      token,
      data: {
        summary: parsed.summary,
        updatesFeed: parsed.updatesFeed,
        staffList: parsed.staffList,
      },
      at: typeof parsed.at === 'number' ? parsed.at : Date.now(),
    };
  } catch {
    /* ignore */
  }
}

export function clearAdminDashboardCache(forToken: string | null | undefined): void {
  memory = null;
  const t = forToken?.trim();
  if (t) {
    void AsyncStorage.removeItem(storageKey(t)).catch(() => {});
  }
}
