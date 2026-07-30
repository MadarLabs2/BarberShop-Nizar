/**
 * Shared appointment card for customer screens.
 * Used by Home (carousel) and Appointments (list).
 */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Dimensions,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { AppointmentDto } from '../../services/bookings.api';
import { formatAppointmentDate } from '../../utils/dates';
import { localizeCatalogString, useAppLocale } from '../../contexts/LocaleContext';
import { colors, spacing, textStyles, presets, radius, iconSize, layout, shadows } from '../../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
/** Same inner width as Home white card + contentBelowCard (gutter = screenPaddingH × 2) */
const HOME_CONTENT_INNER_WIDTH = SCREEN_WIDTH - layout.screenPaddingH * 2;
/** Multi-card carousel: slightly narrower so the next card peeks */
const CAROUSEL_MULTI_WIDTH = HOME_CONTENT_INNER_WIDTH - 18;

export interface AppointmentCardProps {
  item: AppointmentDto;
  key?: React.Key;
  /** 'carousel' = Home horizontal scroll; 'list' = Appointments vertical list */
  variant?: 'carousel' | 'list';
  /** When carousel + single card, no left margin */
  carouselSingle?: boolean;
  showPrice?: boolean;
  /** Options button (ellipsis) — used by Home */
  onOptions?: () => void;
  /** Cancel button — used by Appointments; shows Alert then calls */
  onCancel?: (id: string) => void;
  /** Opens booking to change day/time/service (requires staffId/branchId/serviceId on item). */
  onEdit?: (item: AppointmentDto) => void;
  isPast?: boolean;
  isCancelling?: boolean;
}

export function AppointmentCard({
  item,
  variant = 'list',
  carouselSingle = false,
  showPrice = false,
  onOptions,
  onCancel,
  onEdit,
  isPast = false,
  isCancelling = false,
}: AppointmentCardProps) {
  const { t } = useTranslation();
  const { locale, localeTag } = useAppLocale();
  const serviceDisplay = localizeCatalogString(item.serviceName, locale);
  const branchDisplay = localizeCatalogString(item.branchName, locale);
  const formattedDate = formatAppointmentDate(item.date, item.time, localeTag);

  const handleCancel = () => {
    Alert.alert(
      t('appointmentCard.cancelTitle'),
      t('appointmentCard.cancelMsg', { service: serviceDisplay, when: formattedDate }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('appointmentCard.cancelYes'),
          style: 'destructive',
          onPress: () => onCancel?.(item.id),
        },
      ]
    );
  };

  const isCarousel = variant === 'carousel';
  /** List + edit/delete: one footer block (price + actions) — avoids stacked dividers */
  const hasListActionFooter = !isCarousel && !!onCancel && !isPast && !!onEdit;

  return (
    <View
      style={[
        styles.card,
        !isCarousel && styles.cardList,
        isCarousel && styles.cardCarousel,
        isCarousel && (carouselSingle ? styles.cardCarouselSingle : styles.cardCarouselMulti),
      ]}
    >
      {onOptions && (
        <TouchableOpacity
          style={styles.optionsBtn}
          onPress={onOptions}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.optionsA11y')}
        >
          <Ionicons name="ellipsis-vertical" size={iconSize.md} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      <View
        style={[
          styles.cardContent,
          !isCarousel && styles.cardContentListCompact,
          isCarousel && styles.cardContentCarouselCompact,
        ]}
      >
        <Text
          style={[
            styles.serviceName,
            isCarousel && styles.serviceNameCarouselCompact,
            !isCarousel && styles.serviceNameListNoOptions,
            !isCarousel && styles.serviceNameListCompact,
          ]}
        >
          {serviceDisplay}
        </Text>
        {/* RTL: carousel — one stacked block (ספר → סניף → תאריך/שעה) hugging logical start; no space-between corners */}
        {isCarousel ? (
          <View style={styles.carouselMetaShell}>
            <View style={[styles.barberRow, styles.barberRowCarouselCompact]}>
              <View style={[styles.barberAvatar, styles.barberAvatarCarouselCompact]}>
                <Ionicons name="person" size={16} color={colors.textMuted} />
              </View>
              <Text style={[styles.barberLabel, styles.barberLabelCarouselCompact]}>
                {t('appointmentCard.atStaff', { name: item.staffName })}
              </Text>
            </View>
            <View style={[styles.infoChip, styles.infoChipCarouselOrdered]}>
              <Ionicons name="storefront-outline" size={16} color={colors.textSecondary} />
              <Text
                style={[styles.infoChipText, styles.infoChipTextCarouselOrdered]}
                numberOfLines={1}
              >
                {branchDisplay}
              </Text>
            </View>
            <View style={[styles.dateTimeRow, styles.dateTimeRowCarouselOrdered]}>
              <View style={[styles.dateTimeChip, styles.dateTimeChipFirst, styles.dateTimeChipCarouselCompact]}>
                <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                <Text
                  style={[styles.dateTimeText, styles.dateTimeTextCarouselCompact, styles.dateTimeTextWithWeekday]}
                  numberOfLines={2}
                >
                  {formattedDate}
                </Text>
              </View>
              <View style={[styles.dateTimeChip, styles.dateTimeChipCarouselCompact]}>
                <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                <Text style={[styles.dateTimeText, styles.dateTimeTextCarouselCompact]}>{item.time}</Text>
              </View>
            </View>
          </View>
        ) : (
          <>
            <View style={[styles.metaBlock, styles.metaBlockListCompact]}>
              <View style={[styles.barberRow, styles.barberRowListCompact]}>
                <View style={[styles.barberAvatar, styles.barberAvatarListCompact]}>
                  <Ionicons name="person" size={16} color={colors.textMuted} />
                </View>
                <Text style={[styles.barberLabel, styles.barberLabelListCompact]}>
                  {t('appointmentCard.atStaff', { name: item.staffName })}
                </Text>
              </View>
              <View style={[styles.infoChip, styles.infoChipListCompact]}>
                <Ionicons name="storefront-outline" size={16} color={colors.textSecondary} />
                <Text style={[styles.infoChipText, styles.infoChipTextListCompact]}>{branchDisplay}</Text>
              </View>
            </View>
            <View style={[styles.dateTimeRow, styles.dateTimeRowListCompact]}>
              <View style={[styles.dateTimeChip, styles.dateTimeChipFirst, styles.dateTimeChipListCompact]}>
                <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                <Text
                  style={[styles.dateTimeText, styles.dateTimeTextListCompact, styles.dateTimeTextWithWeekday]}
                  numberOfLines={2}
                >
                  {formattedDate}
                </Text>
              </View>
              <View style={[styles.dateTimeChip, styles.dateTimeChipListCompact]}>
                <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                <Text style={[styles.dateTimeText, styles.dateTimeTextListCompact]}>{item.time}</Text>
              </View>
            </View>
          </>
        )}
        {showPrice && !hasListActionFooter && (
          <View style={[styles.priceRow, !isCarousel && styles.priceRowList]}>
            <Text style={[styles.price, !isCarousel && styles.priceList]}>₪{item.price}</Text>
          </View>
        )}
      </View>
      {hasListActionFooter ? (
        <View style={styles.listFooterShell}>
          {showPrice && (
            <View style={styles.priceInListFooter}>
              <Text style={[styles.price, styles.priceList]}>₪{item.price}</Text>
            </View>
          )}
          <View style={[styles.actionsRow, styles.actionsRowList]}>
            <Pressable
              style={({ pressed }) => [
                styles.actionHalf,
                styles.actionHalfCompact,
                styles.actionDelete,
                pressed && styles.actionPressed,
                isCancelling && styles.cancelButtonDisabled,
              ]}
              onPress={handleCancel}
              disabled={isCancelling}
              android_ripple={{ color: 'rgba(185, 28, 28, 0.12)' }}
              accessibilityRole="button"
              accessibilityLabel={t('appointmentCard.delete')}
            >
              {isCancelling ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={iconSize.sm} color={colors.danger} />
                  <Text style={styles.actionDeleteText}>{t('appointmentCard.delete')}</Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.actionHalf,
                styles.actionHalfCompact,
                styles.actionEdit,
                pressed && styles.actionEditPressed,
              ]}
              onPress={() => onEdit(item)}
              android_ripple={{ color: 'rgba(255, 255, 255, 0.28)' }}
              accessibilityRole="button"
              accessibilityLabel={t('appointmentCard.edit')}
            >
              <Ionicons name="create-outline" size={iconSize.sm} color={colors.onPrimary} />
              <Text style={styles.actionEditText}>{t('appointmentCard.edit')}</Text>
            </Pressable>
          </View>
        </View>
      ) : isCarousel && onCancel && !isPast && onEdit ? (
        <View style={[styles.actionsRow, !isCarousel && styles.actionsRowList]}>
          <Pressable
            style={({ pressed }) => [
              styles.actionHalf,
              !isCarousel && styles.actionHalfCompact,
              styles.actionDelete,
              pressed && styles.actionPressed,
              isCancelling && styles.cancelButtonDisabled,
            ]}
            onPress={handleCancel}
            disabled={isCancelling}
            android_ripple={{ color: 'rgba(185, 28, 28, 0.12)' }}
            accessibilityRole="button"
            accessibilityLabel={t('appointmentCard.delete')}
          >
            {isCancelling ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <>
                <Ionicons name="trash-outline" size={iconSize.sm} color={colors.danger} />
                <Text style={styles.actionDeleteText}>{t('appointmentCard.delete')}</Text>
              </>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.actionHalf,
              !isCarousel && styles.actionHalfCompact,
              styles.actionEdit,
              pressed && styles.actionEditPressed,
            ]}
            onPress={() => onEdit(item)}
            android_ripple={{ color: 'rgba(255, 255, 255, 0.28)' }}
            accessibilityRole="button"
            accessibilityLabel={t('appointmentCard.edit')}
          >
            <Ionicons name="create-outline" size={iconSize.sm} color={colors.onPrimary} />
            <Text style={styles.actionEditText}>{t('appointmentCard.edit')}</Text>
          </Pressable>
        </View>
      ) : onCancel && !isPast ? (
        <TouchableOpacity
          style={[styles.cancelButton, isCancelling && styles.cancelButtonDisabled]}
          onPress={handleCancel}
          disabled={isCancelling}
          activeOpacity={0.85}
        >
          {isCancelling ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Text style={styles.cancelButtonText}>{t('appointmentCard.cancelTap')}</Text>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: presets.card,
  /** Appointments list — match Home carousel shell (width = column; accent + border same as carousel) */
  cardList: {
    marginBottom: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    borderStartWidth: 4,
    borderStartColor: colors.accent,
    ...shadows.card,
    shadowOpacity: 0.08,
    elevation: 3,
  },
  cardCarousel: {
    marginBottom: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    borderStartWidth: 3,
    borderStartColor: colors.accent,
    ...shadows.card,
    shadowOpacity: 0.06,
    elevation: 2,
  },
  /** Home: one card — full width of padded column (matches gallery + hero photo) */
  cardCarouselSingle: {
    width: '100%',
    alignSelf: 'stretch',
  },
  /** Home: horizontal list — fixed width, spacing between cards (RTL) */
  cardCarouselMulti: {
    width: CAROUSEL_MULTI_WIDTH,
    marginEnd: spacing.md,
  },
  cardContent: { padding: spacing.md + 2 },
  /** Home carousel — roomier than list compact so the card reads “fresh”, not squeezed */
  cardContentCarouselCompact: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  serviceNameCarouselCompact: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: spacing.xs,
    paddingEnd: 40,
  },
  /** Grouped detail strip — reads as one ordered unit under the service title */
  carouselMetaShell: {
    alignSelf: 'stretch',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  barberRowCarouselCompact: {
    gap: spacing.sm,
  },
  barberAvatarCarouselCompact: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  barberLabelCarouselCompact: {
    fontSize: 14,
    lineHeight: 19,
  },
  infoChipCarouselOrdered: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm + 2,
    gap: 6,
    alignSelf: 'flex-end',
    maxWidth: '100%',
    backgroundColor: colors.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  infoChipTextCarouselOrdered: {
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 1,
  },
  /** Chips follow the same edge as barber + branch (no floating center strip) */
  dateTimeRowCarouselOrdered: {
    marginTop: 0,
    marginBottom: 0,
    gap: spacing.sm,
    alignSelf: 'flex-end',
    justifyContent: 'flex-start',
  },
  dateTimeChipCarouselCompact: {
    paddingVertical: 5,
    paddingHorizontal: spacing.sm + 2,
    gap: 6,
    backgroundColor: colors.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  dateTimeTextCarouselCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  dateTimeTextWithWeekday: {
    textAlign: 'right',
    writingDirection: 'rtl',
    flexShrink: 1,
    maxWidth: 200,
  },
  /** List: tighter body only (carousel unchanged) */
  cardContentListCompact: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  /** List has no ⋮ menu — no extra end padding on title */
  serviceNameListNoOptions: { paddingEnd: 0 },
  serviceNameListCompact: {
    fontSize: 16,
    marginBottom: spacing.xs,
    lineHeight: 22,
  },
  metaBlockListCompact: {
    gap: 2,
    marginBottom: 0,
  },
  barberRowListCompact: {
    gap: spacing.xs,
  },
  barberAvatarListCompact: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  barberLabelListCompact: {
    fontSize: 14,
    lineHeight: 19,
  },
  infoChipListCompact: {
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    gap: 4,
  },
  infoChipTextListCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  dateTimeRowListCompact: {
    marginTop: spacing.xs,
    marginBottom: 0,
    gap: 6,
  },
  dateTimeChipListCompact: {
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    gap: 4,
  },
  dateTimeTextListCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  /** Logical end — menu sits on trailing edge in RTL/LTR */
  optionsBtn: {
    position: 'absolute',
    top: 8,
    end: 8,
    padding: 6,
    zIndex: 1,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
  },
  serviceName: {
    ...textStyles.sectionTitle,
    fontSize: 18,
    marginBottom: spacing.sm,
    paddingEnd: 44,
  },
  /** Barber + branch: hug logical start (right) for Hebrew */
  metaBlock: {
    alignSelf: 'stretch',
    alignItems: 'flex-end',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  barberRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
  },
  barberAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  barberLabel: {
    ...textStyles.body,
    fontWeight: '500',
  },
  infoChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 5,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.full,
    gap: 6,
  },
  infoChipText: {
    ...textStyles.bodySmall,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  dateTimeRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    gap: spacing.sm,
    alignItems: 'center',
  },
  dateTimeChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 5,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.full,
    gap: 6,
  },
  dateTimeChipFirst: {},
  dateTimeText: {
    ...textStyles.bodySmall,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  priceRow: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  priceRowList: {
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    alignSelf: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  price: { ...textStyles.sectionTitle, fontSize: 18 },
  priceList: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
    fontVariant: Platform.OS === 'ios' ? ['tabular-nums'] : undefined,
    letterSpacing: -0.2,
  },
  actionsRow: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  /** List footer: price + actions — same white as card body */
  listFooterShell: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  priceInListFooter: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: 0,
    alignItems: 'flex-end',
  },
  /** Actions row inside list footer — no extra top rule */
  actionsRowList: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    marginTop: 0,
  },
  actionHalf: {
    flex: 1,
    minHeight: layout.hitMin - 4,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.md,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    borderRadius: radius.lg,
  },
  actionHalfCompact: {
    minHeight: 44,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  actionPressed: {
    opacity: Platform.OS === 'ios' ? 0.92 : 1,
  },
  actionEditPressed: {
    opacity: Platform.OS === 'ios' ? 0.9 : 1,
    transform: [{ scale: Platform.OS === 'ios' ? 0.985 : 1 }],
  },
  /** Delete — outline, calmer than solid pink */
  actionDelete: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger + '55',
  },
  actionDeleteText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.15,
  },
  /** Edit — primary gold, restrained shadow */
  actionEdit: {
    backgroundColor: colors.accent,
    borderWidth: 0,
    ...shadows.pillOverlay,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  actionEditText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  cancelButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    alignItems: 'center',
    minHeight: layout.hitMin,
    justifyContent: 'center',
  },
  cancelButtonDisabled: { opacity: 0.7 },
  cancelButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
});
