import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { he } from './locales/he';
import { ar } from './locales/ar';

void i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    ar: { translation: ar },
  },
  lng: 'he',
  fallbackLng: 'he',
  compatibilityJSON: 'v4',
  interpolation: { escapeValue: false },
});

export default i18n;
