import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';

const STORAGE_KEY = '@barbershop/app_locale';

export type AppLocale = 'he' | 'ar';

/**
 * API/catalog strings are often stored in Hebrew. When the UI is Arabic, swap known
 * exact matches so branch/service titles read naturally (extend as your catalog grows).
 */
const CATALOG_HE_TO_AR: Record<string, string> = {
  'טיפולים': 'علاجات',
  'גת המשולש': 'جت المثلث',
};

/** Normalize API spacing for lookup. */
export function localizeCatalogString(text: string | null | undefined, locale: AppLocale): string {
  const raw = text == null ? '' : String(text).trim();
  if (!raw || locale !== 'ar') return raw;
  const compact = raw.replace(/\s+/g, ' ');
  return CATALOG_HE_TO_AR[raw] ?? CATALOG_HE_TO_AR[compact] ?? raw;
}

/**
 * Picks the admin-entered name matching the current app language for a service/branch — real
 * per-record translation (nameHe/nameAr), not the CATALOG_HE_TO_AR dictionary guess above. Falls
 * back to the other language rather than ever showing a blank string (e.g. legacy rows before an
 * admin fills in both).
 */
export function pickLocalizedName(item: { nameHe: string; nameAr: string }, locale: AppLocale): string {
  return locale === 'ar' ? item.nameAr || item.nameHe : item.nameHe || item.nameAr;
}

type LocaleContextValue = {
  locale: AppLocale;
  setLocale: (next: AppLocale) => Promise<void>;
  /** BCP 47 tag for `toLocaleDateString` / `toLocaleString` */
  localeTag: string;
  /**
   * `locale` prop for `@react-native-community/datetimepicker` (UIDatePicker on iOS).
   * Must match app language so month/day labels are not stuck on Hebrew.
   */
  pickerLocale: 'he-IL' | 'ar-SA-u-ca-gregory-nu-latn';
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>('he');

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw === 'ar' || raw === 'he') {
          setLocaleState(raw);
          await i18n.changeLanguage(raw);
        }
      } catch {
        /* keep default */
      }
    })();
  }, []);

  const setLocale = useCallback(async (next: AppLocale) => {
    setLocaleState(next);
    await i18n.changeLanguage(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      // Arabic dates: force Gregorian calendar + Western digits (0-9).
      localeTag: locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'he-IL',
      // Keep Arabic labels, but force Gregorian calendar + Western digits in native pickers.
      pickerLocale: locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'he-IL',
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useAppLocale(): LocaleContextValue {
  const v = useContext(LocaleContext);
  if (!v) {
    throw new Error('useAppLocale must be used within LocaleProvider');
  }
  return v;
}
