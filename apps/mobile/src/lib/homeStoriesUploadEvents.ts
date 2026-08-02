import { DeviceEventEmitter } from 'react-native';
import type { HomeStoryAuthor, HomeStoryItem } from '../services/stories.api';

export const HOME_STORY_UPLOADED_EVENT = 'homeStoryUploaded';
export const HOME_STORY_DELETED_EVENT = 'homeStoryDeleted';

export type HomeStoryUploadedPayload =
  | { variant: 'salon'; story: HomeStoryItem; replaceTempId?: string }
  | {
      variant: 'staff';
      story: HomeStoryItem;
      staffId: string;
      displayName: string;
      /** Uploader's own avatar — without it, a staff member's very first story (no existing
       * author bucket to inherit an avatar from) shows a placeholder icon until the next real
       * fetch instead of their photo immediately. */
      avatarUrl: string | null;
      replaceTempId?: string;
    };

export function emitHomeStoryUploaded(payload: HomeStoryUploadedPayload): void {
  DeviceEventEmitter.emit(HOME_STORY_UPLOADED_EVENT, payload);
}

export function emitHomeStoryDeleted(storyId: string): void {
  DeviceEventEmitter.emit(HOME_STORY_DELETED_EVENT, { id: storyId });
}

/** Strip a story id and drop author buckets that become empty (e.g. after delete). */
export function removeStoryIdFromAuthors(authors: HomeStoryAuthor[], id: string): HomeStoryAuthor[] {
  return authors
    .map((a) => ({ ...a, stories: a.stories.filter((s) => s.id !== id) }))
    .filter((a) => a.stories.length > 0);
}

export function pendingPayloadFromUpload(p: HomeStoryUploadedPayload): HomeStoryUploadedPayload {
  if (p.variant === 'salon') return { variant: 'salon', story: p.story };
  return { variant: 'staff', story: p.story, staffId: p.staffId, displayName: p.displayName, avatarUrl: p.avatarUrl };
}

function stripStoryIdEverywhere(authors: HomeStoryAuthor[], id: string): HomeStoryAuthor[] {
  return authors.map((a) => ({
    ...a,
    stories: a.stories.filter((s) => s.id !== id),
  }));
}

/**
 * Merges a freshly uploaded story into the grouped authors list used on the customer home rail
 * (matches server grouping: one salon bucket, then staff buckets).
 */
export function mergeHomeStoryIntoAuthors(
  authors: HomeStoryAuthor[],
  payload: HomeStoryUploadedPayload,
): HomeStoryAuthor[] {
  const { story } = payload;
  const base = stripStoryIdEverywhere(authors, story.id);

  if (payload.variant === 'salon') {
    const salonIdx = base.findIndex((a) => a.kind === 'salon' && a.authorKey === 'salon');
    if (salonIdx === -1) {
      return [
        {
          authorKey: 'salon',
          kind: 'salon',
          displayName: '',
          avatarUrl: null,
          stories: [story],
        },
        ...base,
      ];
    }
    return base.map((a, i) =>
      i === salonIdx ? { ...a, stories: [story, ...a.stories] } : a,
    );
  }

  const { staffId, displayName, avatarUrl } = payload;
  const staffIdx = base.findIndex((a) => a.authorKey === staffId);
  if (staffIdx === -1) {
    const newAuthor: HomeStoryAuthor = {
      authorKey: staffId,
      kind: 'staff',
      displayName,
      avatarUrl,
      stories: [story],
    };
    const salonIdx = base.findIndex((a) => a.kind === 'salon' && a.authorKey === 'salon');
    if (salonIdx === -1) return [newAuthor, ...base];
    return [...base.slice(0, salonIdx + 1), newAuthor, ...base.slice(salonIdx + 1)];
  }

  return base.map((a, i) => (i === staffIdx ? { ...a, stories: [story, ...a.stories] } : a));
}

/** Re-applies pending uploads on top of a fresh server list (avoids wiping optimistic tiles if fetch was stale). */
export function mergePendingUploadsIntoServer(
  serverAuthors: HomeStoryAuthor[],
  pending: HomeStoryUploadedPayload[],
): HomeStoryAuthor[] {
  const serverIds = new Set(serverAuthors.flatMap((a) => a.stories.map((s) => s.id)));
  let merged = serverAuthors;
  for (const p of pending) {
    if (serverIds.has(p.story.id)) continue;
    merged = mergeHomeStoryIntoAuthors(merged, p);
  }
  return merged;
}
