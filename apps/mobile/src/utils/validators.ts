/**
 * Centralized validation – used across Login, Register, Admin, Dashboard, Booking.
 * Keep logic consistent and maintainable.
 */

/** Israeli mobile: 9 digits starting with 5, or 10 starting with 05, or E.164 (+972...) */
export function isValidPhone(phone: string): boolean {
  if (!phone?.trim()) return false;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 9) return digits.startsWith('5');
  if (digits.length === 10) return digits.startsWith('05');
  if (digits.length >= 9) return digits.slice(-9).startsWith('5'); // E.164 +972501234567
  return false;
}

export function isValidOtpCode(code: string, length = 6): boolean {
  if (length < 4 || length > 10) return /^\d{6}$/.test(code);
  return new RegExp(`^\\d{${length}}$`).test(code);
}

export interface BirthDateResult {
  valid: boolean;
  error?: string;
}

/** Validate birth date: real calendar date, in the past, reasonable age (12–120 years).
 * Birth date is optional (matches the backend, which accepts a null birthDate) — leaving
 * all three fields empty is valid; only a partial or malformed entry is rejected. */
export function validateBirthDate(day: string, month: string, year: string): BirthDateResult {
  if (!day && !month && !year) return { valid: true };
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (!day || !month || !year) return { valid: false, error: 'יש למלא תאריך לידה מלא' };
  if (isNaN(d) || isNaN(m) || isNaN(y)) return { valid: false, error: 'תאריך לידה לא תקין' };
  if (y < 1900 || y > 2100) return { valid: false, error: 'שנה לא תקינה' };
  if (m < 1 || m > 12) return { valid: false, error: 'חודש לא תקין (1–12)' };
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d < 1 || d > daysInMonth) return { valid: false, error: `יום לא תקין בחודש זה (1–${daysInMonth})` };
  const birth = new Date(y, m - 1, d);
  if (birth.getTime() !== birth.getTime()) return { valid: false, error: 'תאריך לא תקין' };
  const now = new Date();
  if (birth >= now) return { valid: false, error: 'תאריך הלידה חייב להיות בעבר' };
  const age = (now.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (age < 12) return { valid: false, error: 'גיל מינימלי 12 שנים' };
  if (age > 120) return { valid: false, error: 'תאריך לידה לא סביר' };
  return { valid: true };
}

/** YYYY-MM-DD format and valid calendar date */
export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** HH:MM or H:MM, hours 0-23, minutes 0-59 */
export function isValidTimeString(s: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!match) return false;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** Parse HH:MM to minutes since midnight. Use with isValidTimeString first. */
export function parseTimeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Validate working-time range: both valid HH:MM, start < end. */
export function validateWorkingTimeRange(
  start: string,
  end: string
): { valid: boolean; error?: string } {
  if (!start?.trim() || !end?.trim()) return { valid: false, error: 'שעות התחלה וסיום חובות' };
  if (!isValidTimeString(start) || !isValidTimeString(end)) return { valid: false, error: 'פורמט שעה לא תקין (HH:MM)' };
  if (parseTimeToMins(start) >= parseTimeToMins(end)) return { valid: false, error: 'שעת סיום חייבת להיות אחרי שעת התחלה' };
  return { valid: true };
}

/** Service price: non-negative number */
export function validateServicePrice(price: string): { valid: boolean; error?: string } {
  const n = parseInt(price, 10);
  if (isNaN(n)) return { valid: false, error: 'מחיר חייב להיות מספר' };
  if (n < 0) return { valid: false, error: 'מחיר לא יכול להיות שלילי' };
  if (n > 9999) return { valid: false, error: 'מחיר גבוה מדי' };
  return { valid: true };
}

/** Service duration: 5–480 minutes */
export function validateServiceDuration(duration: string): { valid: boolean; error?: string } {
  const n = parseInt(duration, 10);
  if (isNaN(n)) return { valid: false, error: 'משך חייב להיות מספר' };
  if (n < 5) return { valid: false, error: 'משך מינימלי 5 דקות' };
  if (n > 480) return { valid: false, error: 'משך מקסימלי 8 שעות (480 דקות)' };
  return { valid: true };
}

/** Staff phone: empty or valid Israeli format */
export function validateStaffPhone(phone: string): { valid: boolean; error?: string } {
  const t = phone.trim();
  if (!t) return { valid: true }; // optional
  if (!isValidPhone(t)) return { valid: false, error: 'מספר טלפון לא תקין (למשל 050-1234567)' };
  return { valid: true };
}

/** Name: non-empty, reasonable length */
export function validateName(name: string, field = 'שם'): { valid: boolean; error?: string } {
  const t = name.trim();
  if (!t) return { valid: false, error: `${field} חובה` };
  if (t.length > 100) return { valid: false, error: `${field} ארוך מדי` };
  return { valid: true };
}

/** Broadcast: title required, max lengths */
export function validateBroadcast(title: string, body: string): { valid: boolean; error?: string } {
  const t = title.trim();
  if (!t) return { valid: false, error: 'כותרת חובה' };
  if (t.length > 200) return { valid: false, error: 'כותרת ארוכה מדי (מקסימום 200 תווים)' };
  if (body.trim().length > 2000) return { valid: false, error: 'תוכן ארוך מדי (מקסימום 2000 תווים)' };
  return { valid: true };
}
