/**
 * Asset registry – central place for all app media.
 * Import from here instead of scattering require() paths.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// App icons (Expo app.json references)
export const icons = {
  icon: require('../../assets/icon.png'),
  splash: require('../../assets/splash.png'),
  adaptiveIcon: require('../../assets/adaptive-icon.png'),
  favicon: require('../../assets/favicon.png'),
  /** Barbershop pole logo — Home header, beside the brand title */
  logo: require('../../assets/logo.png'),
  /** Gold badge logo — drawer dashboard rows (top-bar button + admin/staff dashboard menu items) */
  logoBadgeGold: require('../../assets/logo-badge-gold.png'),
} as const;

// Home screen media
export const home = {
  /** Hero video – top of home */
  video: require('../../assets/home/barb.mp4'),
  /** Salon image – flip card "קצת על המספרה" */
  about: require('../../assets/home/barbershop.jpg'),
  /** Hero section image – Waze/contact buttons area */
  hero: require('../../assets/home/barber1.jpeg'),
  /** Products "המוצרים שלנו" */
  products: {
    mach: require('../../assets/home/mach.jpeg'),
    crm: require('../../assets/home/crm.webp'),
  } as const,
} as const;
