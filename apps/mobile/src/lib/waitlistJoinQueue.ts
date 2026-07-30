import type { MyWaitlistEntry } from '../services/bookings.api';

const queue: MyWaitlistEntry[] = [];

/** Call after a successful join so Appointments can merge before/without waiting for GET /waitlist/my. */
export function notifyWaitlistJoined(entry: MyWaitlistEntry): void {
  queue.push(entry);
}

/** Called when loading waitlist on Appointments — pending rows are merged with server (server wins on same id). */
export function drainWaitlistJoinQueue(): MyWaitlistEntry[] {
  const out = [...queue];
  queue.length = 0;
  return out;
}

export function mergeWaitlistEntries(pending: MyWaitlistEntry[], server: MyWaitlistEntry[]): MyWaitlistEntry[] {
  const m = new Map<string, MyWaitlistEntry>();
  for (const x of pending) m.set(x.id, x);
  for (const x of server) m.set(x.id, x);
  return Array.from(m.values());
}
