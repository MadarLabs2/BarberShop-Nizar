export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return `+972${digits.slice(1)}`;
  if (digits.startsWith('972')) return `+${digits}`;
  return `+972${digits}`;
}

/** Normalize to last 9 digits for storage/API (Israeli format) */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-9) || '';
}

/** Display format for Israeli phones (05X-XXX-XXXX) */
export function formatPhoneDisplay(p: string | null | undefined): string {
  if (!p) return '';
  const s = String(p).replace(/\D/g, '');
  const digits = s.length > 9 ? s.slice(-9) : s;
  if (digits.length === 9 && digits.startsWith('5')) return `0${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  if (digits.length === 10 && digits.startsWith('05')) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return p;
}
