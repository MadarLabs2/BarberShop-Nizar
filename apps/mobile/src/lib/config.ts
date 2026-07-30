/** Customer-facing app name (header, drawer, about). */
export const BRAND_NAME = 'BarberShop';
export const MADARLABS_INSTAGRAM_USERNAME = 'madarlabs';
export const MADARLABS_INSTAGRAM_URL = `https://instagram.com/${MADARLABS_INSTAGRAM_USERNAME}`;
export const MADARLABS_CONTACT_PHONE = '0529338598';
export const MADARLABS_CONTACT_EMAIL = 'info.madarlabs@gmail.com';

/** Barbershop contact – used for tel/wa.me links */
export const BARBERSHOP_PHONE = '0526867838';
export const BARBERSHOP_PHONE_INTL = '+972526867838';

/** Place name for Waze / Google Maps links (shared with Home hero and Directions screen). */
export const BARBERSHOP_MAP_QUERY = 'BarberShop';

/** Optional URLs – set when content is ready. Leave empty to show "coming soon" UX. */
export const TERMS_URL = '';
export const PRIVACY_URL = '';
export const RATE_APP_URL = ''; // Store link when published, e.g. https://play.google.com/store/apps/details?id=com.barbershop.v2

/** Social links – set when pages exist. Empty = hide button. */
export const SOCIAL_LINKS = {
  youtube: '',
  facebook: '',
  instagram: MADARLABS_INSTAGRAM_URL,
  whatsapp: `https://wa.me/${BARBERSHOP_PHONE_INTL.replace('+', '')}`,
} as const;

/** קישור ישיר לשיחת WhatsApp עם העסק (פורמט wa.me). */
export const WHATSAPP_CHAT_URL = SOCIAL_LINKS.whatsapp;

/** Opens WhatsApp to the business number with a prefilled message (caller passes localized text). */
export function buildProductInquiryWhatsAppUrl(prefilledMessage: string): string {
  const base = WHATSAPP_CHAT_URL.split('?')[0];
  return `${base}?text=${encodeURIComponent(prefilledMessage)}`;
}
