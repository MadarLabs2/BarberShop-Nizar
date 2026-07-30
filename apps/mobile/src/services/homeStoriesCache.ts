import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image, InteractionManager } from 'react-native';
import type { AdminStoryRow, HomeStoryAuthor, HomeStoryItem } from './stories.api';

const PUBLIC_HOME_STORIES_KEY = 'home_stories_public_cache_v1';
const HOME_STORIES_MANAGE_KEY_PREFIX = 'home_stories_manage_cache_v1';
const PUBLIC_HOME_STORIES_TTL_MS = 12 * 60 * 60 * 1000;
const MANAGE_HOME_STORIES_TTL_MS = 12 * 60 * 60 * 1000;

type Envelope<T> = {
  at: number;
  data: T;
};

/**
 * After a warm disk hit, skip the JSON round-trip (and follow-up image warms) for a short window so
 * tab switches / Home remounts do not constantly revalidate against the API.
 */
export const HOME_STORIES_API_SILENCE_MS = 15 * 60 * 1000;

export type PublicHomeStoriesCached = { authors: HomeStoryAuthor[]; cacheAt: number };

/** In-memory copy of the public home-stories pack — survives Home unmount/remount within the session TTL. */
let publicHomeStoriesMemory: PublicHomeStoriesCached | null = null;

/** Dedupe `Image.prefetch` within the JS session — warm paths run often; same URL must not fan out repeatedly. */
const sessionPrefetchedUrls = new Set<string>();

export function clearSessionImagePrefetchDedupe(): void {
  sessionPrefetchedUrls.clear();
  publicHomeStoriesMemory = null;
}

/** Single-flight prefetch per URL per app session (logout clears the set). */
export function prefetchImageUrlOnce(url: string | null | undefined): void {
  const trimmed = String(url || '').trim();
  if (!trimmed) return;
  if (sessionPrefetchedUrls.has(trimmed)) return;
  sessionPrefetchedUrls.add(trimmed);
  void Image.prefetch(trimmed).catch(() => {});
}

function quickHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function manageStoriesKey(token: string, variant: 'staff' | 'admin'): string {
  return `${HOME_STORIES_MANAGE_KEY_PREFIX}_${variant}_${quickHash(token)}`;
}

async function readEnvelope<T>(key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<T> | null;
    if (!parsed || typeof parsed.at !== 'number' || parsed.data == null) return null;
    if (Date.now() - parsed.at > maxAgeMs) {
      await AsyncStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

async function writeEnvelope<T>(key: string, data: T, at: number = Date.now()): Promise<void> {
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        at,
        data,
      } satisfies Envelope<T>),
    );
  } catch {
    /* ignore cache persistence failures */
  }
}

export function prefetchRemoteImages(urls: Array<string | null | undefined>): void {
  urls.forEach((url) => prefetchImageUrlOnce(url));
}

/** Same story order as the Home rail (newest first) — used for prefetch priority without i18n. */
function flattenAuthorsToStoryPrefetchRail(authors: HomeStoryAuthor[]): HomeStoryRailPrefetchEntry[] {
  const items: HomeStoryRailPrefetchEntry[] = [];
  for (const a of authors) {
    for (const story of a.stories) {
      items.push({ story, avatarUrl: a.avatarUrl ?? null });
    }
  }
  items.sort((x, y) => new Date(y.story.createdAt).getTime() - new Date(x.story.createdAt).getTime());
  return items;
}

const RAIL_PREFETCH_LEAD_COUNT = 6;
const RAIL_PREFETCH_BATCH = 3;
const RAIL_PREFETCH_STEP_MS = 52;

export type HomeStoryRailPrefetchEntry = {
  story: HomeStoryItem;
  avatarUrl: string | null;
};

/**
 * Prefetch rail card images without a single burst: lead indices immediately, remainder in small
 * delayed batches after interactions (deduped via prefetchImageUrlOnce).
 */
export function scheduleStaggeredRailStoryPrefetches(
  railItems: ReadonlyArray<HomeStoryRailPrefetchEntry>,
  priorityIndices: readonly number[],
): void {
  const n = railItems.length;
  if (n === 0) return;

  const prioritySet = new Set<number>();
  for (const raw of priorityIndices) {
    const i = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : -1;
    if (i >= 0 && i < n) prioritySet.add(i);
  }

  const prefetchIndex = (idx: number) => {
    const e = railItems[idx];
    if (!e) return;
    prefetchImageUrlOnce(e.story.imageUrl);
    prefetchImageUrlOnce(e.avatarUrl);
  };

  prioritySet.forEach(prefetchIndex);

  const rest: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (!prioritySet.has(i)) rest.push(i);
  }
  if (rest.length === 0) return;

  let cursor = 0;
  const runBatch = () => {
    const end = Math.min(cursor + RAIL_PREFETCH_BATCH, rest.length);
    for (; cursor < end; cursor += 1) {
      prefetchIndex(rest[cursor]!);
    }
    if (cursor < rest.length) {
      setTimeout(runBatch, RAIL_PREFETCH_STEP_MS);
    }
  };

  InteractionManager.runAfterInteractions(() => {
    setTimeout(runBatch, RAIL_PREFETCH_STEP_MS);
  });
}

export function warmPublicStoriesImages(authors: HomeStoryAuthor[]): void {
  const flat = flattenAuthorsToStoryPrefetchRail(authors);
  const lead = Array.from({ length: Math.min(RAIL_PREFETCH_LEAD_COUNT, flat.length) }, (_, i) => i);
  scheduleStaggeredRailStoryPrefetches(flat, lead);
}

export function warmManageStoriesImages(rows: Array<HomeStoryItem | AdminStoryRow>): void {
  prefetchRemoteImages(rows.map((row) => row.imageUrl));
}

function isPublicHomeStoriesPackFresh(pack: PublicHomeStoriesCached): boolean {
  return (
    Array.isArray(pack.authors) &&
    pack.authors.length > 0 &&
    typeof pack.cacheAt === 'number' &&
    Date.now() - pack.cacheAt <= PUBLIC_HOME_STORIES_TTL_MS
  );
}

/** Synchronous in-session cache — avoids awaiting AsyncStorage when returning to Home. */
export function getPublicHomeStoriesMemoryCacheSync(): PublicHomeStoriesCached | null {
  if (!publicHomeStoriesMemory) return null;
  if (!isPublicHomeStoriesPackFresh(publicHomeStoriesMemory)) {
    publicHomeStoriesMemory = null;
    return null;
  }
  return publicHomeStoriesMemory;
}

export async function readPublicHomeStoriesCacheWithAge(): Promise<PublicHomeStoriesCached | null> {
  const mem = getPublicHomeStoriesMemoryCacheSync();
  if (mem) return mem;

  try {
    const raw = await AsyncStorage.getItem(PUBLIC_HOME_STORIES_KEY);
    if (!raw) {
      publicHomeStoriesMemory = null;
      return null;
    }
    const parsed = JSON.parse(raw) as Envelope<HomeStoryAuthor[]> | null;
    if (!parsed || typeof parsed.at !== 'number' || !Array.isArray(parsed.data)) {
      publicHomeStoriesMemory = null;
      return null;
    }
    if (Date.now() - parsed.at > PUBLIC_HOME_STORIES_TTL_MS) {
      await AsyncStorage.removeItem(PUBLIC_HOME_STORIES_KEY);
      publicHomeStoriesMemory = null;
      return null;
    }
    const pack: PublicHomeStoriesCached = { authors: parsed.data, cacheAt: parsed.at };
    publicHomeStoriesMemory = pack;
    return pack;
  } catch {
    return null;
  }
}

export async function readPublicHomeStoriesCache(): Promise<HomeStoryAuthor[] | null> {
  const pack = await readPublicHomeStoriesCacheWithAge();
  return pack?.authors ?? null;
}

export async function writePublicHomeStoriesCache(authors: HomeStoryAuthor[]): Promise<void> {
  const at = Date.now();
  await writeEnvelope(PUBLIC_HOME_STORIES_KEY, authors, at);
  publicHomeStoriesMemory = { authors, cacheAt: at };
}

export function readManagedHomeStoriesCache(
  token: string,
  variant: 'staff' | 'admin',
): Promise<Array<HomeStoryItem | AdminStoryRow> | null> {
  return readEnvelope<Array<HomeStoryItem | AdminStoryRow>>(
    manageStoriesKey(token, variant),
    MANAGE_HOME_STORIES_TTL_MS,
  );
}

export function writeManagedHomeStoriesCache(
  token: string,
  variant: 'staff' | 'admin',
  rows: Array<HomeStoryItem | AdminStoryRow>,
): Promise<void> {
  return writeEnvelope(manageStoriesKey(token, variant), rows);
}
