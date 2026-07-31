import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppLocale, type AppLocale } from '../../contexts/LocaleContext';
import { colors, spacing, radius, textStyles, iconSize, shadows } from '../../theme';

type Props = {
  /** Full block (settings) with chips; header = small icon + modal picker */
  variant?: 'default' | 'header';
};

export function LanguageSwitcher({ variant = 'default' }: Props) {
  const { t } = useTranslation();
  const { locale, setLocale } = useAppLocale();
  const [modalOpen, setModalOpen] = useState(false);
  const isHeader = variant === 'header';

  const pick = (next: AppLocale) => {
    void setLocale(next);
  };

  const pickAndClose = (next: AppLocale) => {
    pick(next);
    setModalOpen(false);
  };

  if (isHeader) {
    return (
      <>
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={() => setModalOpen(true)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t('languages.sectionTitle')}
        >
          <Ionicons name="language-outline" size={iconSize.lg} color={colors.accent} />
        </TouchableOpacity>
        <Modal
          visible={modalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setModalOpen(false)}
        >
          <View style={styles.modalRoot}>
            <Pressable style={styles.modalDimmer} onPress={() => setModalOpen(false)} />
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{t('languages.sectionTitle')}</Text>
              <TouchableOpacity
                style={[styles.modalOption, locale === 'he' && styles.modalOptionActive]}
                onPress={() => pickAndClose('he')}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ selected: locale === 'he' }}
              >
                <View style={styles.modalOptionInner}>
                  <Text
                    style={[styles.modalOptionText, locale === 'he' && styles.modalOptionTextActive]}
                    numberOfLines={1}
                  >
                    {t('languages.he')}
                  </Text>
                  <View style={styles.modalCheckSlot}>
                    {locale === 'he' ? (
                      <Ionicons name="checkmark-circle" size={iconSize.md} color={colors.accent} />
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalOption, locale === 'ar' && styles.modalOptionActive]}
                onPress={() => pickAndClose('ar')}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ selected: locale === 'ar' }}
              >
                <View style={styles.modalOptionInner}>
                  <Text
                    style={[styles.modalOptionText, locale === 'ar' && styles.modalOptionTextActive]}
                    numberOfLines={1}
                  >
                    {t('languages.ar')}
                  </Text>
                  <View style={styles.modalCheckSlot}>
                    {locale === 'ar' ? (
                      <Ionicons name="checkmark-circle" size={iconSize.md} color={colors.accent} />
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>{t('languages.sectionTitle')}</Text>
      <Text style={styles.hint}>{t('languages.sectionSubtitle')}</Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.chip, locale === 'he' && styles.chipActive]}
          onPress={() => pick('he')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ selected: locale === 'he' }}
        >
          <Text style={[styles.chipText, locale === 'he' && styles.chipTextActive]}>{t('languages.he')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, locale === 'ar' && styles.chipActive]}
          onPress={() => pick('ar')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ selected: locale === 'ar' }}
        >
          <Text style={[styles.chipText, locale === 'ar' && styles.chipTextActive]}>{t('languages.ar')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  headerIconBtn: {
    padding: spacing.sm,
    minWidth: 40,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalDimmer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.cardStrong,
  },
  modalTitle: {
    ...textStyles.sectionTitle,
    marginBottom: spacing.md,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalOption: {
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  modalOptionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent + '22',
  },
  modalOptionInner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalOptionText: {
    ...textStyles.bodyMedium,
    flex: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalOptionTextActive: {
    fontWeight: '700',
    color: colors.text,
  },
  modalCheckSlot: {
    width: iconSize.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    ...textStyles.sectionTitle,
    marginBottom: spacing.sm,
    alignSelf: 'stretch',
    textAlign: 'right',
  },
  hint: {
    ...textStyles.bodySmall,
    textAlign: 'right',
    marginBottom: spacing.md,
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row-reverse',
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  chip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent + '22',
  },
  chipText: {
    ...textStyles.bodyMedium,
    color: colors.text,
  },
  chipTextActive: {
    color: colors.accent,
    fontWeight: '800',
  },
});
