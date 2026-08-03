import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import Animated, { FadeIn, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
  Switch,
} from 'react-native';
import type { CatalogStaffMember } from '../../services/bookings.api';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { RootDrawerParamList } from '../../navigation/paramList';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { PageIntro } from '../../components/ui/PageIntro';
import { EmptyState } from '../../components/feedback/EmptyState';
import { BottomSheetModal } from '../../components/ui/BottomSheetModal';
import { AppButton } from '../../components/ui/AppButton';
import { useBooking } from '../../hooks/useBooking';
import { useBirthdayReward } from '../../hooks/useBirthdayReward';
import { formatDateDmy, formatDateWithWeekday, getWeekdayNameForYyyyMmDd, toDateString } from '../../utils/dates';
import { prefsOverlapStaffWindow, timeToMins } from '../../utils/waitlistPrefs';
import { useAuth } from '../../hooks/useAuth';
import { openDrawer } from '../../utils/nav';
import { useTranslation } from 'react-i18next';
import { pickLocalizedName, useAppLocale } from '../../contexts/LocaleContext';
import { colors, spacing, radius, shadows, layout, textStyles, presets, iconSize } from '../../theme';
import { LAYOUT_EASE_OUT_SMOOTH, TEAM_SCREEN_ENTER_MS, TEAM_SCREEN_ENTER_RISE_FROM_Y } from '../../theme/motion';
import { revalidateBookableStaffList, syncCustomerPrefetchToken } from '../../services/customerPrefetchCache';

const BOOKING_SUCCESS_NAV_DELAY_MS = 3900;
const STAFF_CARD_WIDTH = 94;
/** Staff avatar press — same ease as ScreenEnter / home shelves for cohesive motion. */
const GALLERY_TIMING_IN = { duration: 200, easing: LAYOUT_EASE_OUT_SMOOTH };
const GALLERY_TIMING_OUT = { duration: 300, easing: LAYOUT_EASE_OUT_SMOOTH };

const galleryStyles = StyleSheet.create({
  section: {
    marginBottom: spacing.md,
    paddingHorizontal: 0,
  },
  sectionTitle: {
    ...textStyles.sectionTitle,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'right',
    marginBottom: spacing.xs + 2,
    paddingHorizontal: layout.screenPaddingH,
  },
  sectionHint: {
    ...textStyles.caption,
    fontSize: 12,
    textAlign: 'right',
    marginBottom: spacing.md,
    color: colors.textTertiary,
    paddingHorizontal: layout.screenPaddingH,
  },
  scroll: {
    alignSelf: 'stretch',
    width: '100%',
  },
  /** RTL: first staff sits on the right; row grows full width so short lists stay right-aligned */
  scrollContent: {
    flexDirection: 'row-reverse',
    flexGrow: 1,
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingHorizontal: layout.screenPaddingH,
    /** Keep the first avatar fully visible on RTL start edge */
    paddingEnd: layout.screenPaddingH + spacing.sm,
    gap: spacing.sm + 2,
    paddingBottom: spacing.xs,
    minWidth: '100%',
  },
  card: {
    width: STAFF_CARD_WIDTH,
    alignItems: 'center',
  },
  avatarRing: {
    width: STAFF_CARD_WIDTH - 8,
    height: STAFF_CARD_WIDTH - 8,
    borderRadius: (STAFF_CARD_WIDTH - 8) / 2,
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    ...shadows.card,
    shadowOpacity: 0.06,
    elevation: 2,
  },
  avatarRingSelected: {
    borderColor: colors.accent,
    borderWidth: 2,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  avatarSpinner: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    marginTop: spacing.xs,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  nameSelected: {
    color: colors.text,
    fontWeight: '700',
  },
  emptyWrap: {
    marginHorizontal: layout.screenPaddingH,
    marginBottom: spacing.lg,
  },
});

function StaffGalleryTile({
  member,
  active,
  showSpinner,
  onSelect,
  onWarmStaffContext,
}: {
  member: CatalogStaffMember;
  active: boolean;
  showSpinner: boolean;
  onSelect: (id: string) => void;
  onWarmStaffContext?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const pressed = useSharedValue(0);
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, 0.96]) }],
  }));
  const onPressIn = useCallback(() => {
    pressed.value = withTiming(1, GALLERY_TIMING_IN);
    onWarmStaffContext?.(member.id);
  }, [pressed, member.id, onWarmStaffContext]);
  const onPressOut = useCallback(() => {
    pressed.value = withTiming(0, GALLERY_TIMING_OUT);
  }, [pressed]);

  return (
    <View style={galleryStyles.card}>
      <Pressable
        onPress={() => onSelect(member.id)}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={t('booking.selectBarberA11y', { name: member.name })}
        android_ripple={{ color: 'rgba(201, 162, 39, 0.14)', foreground: false }}
      >
        <Animated.View style={[galleryStyles.avatarRing, active && galleryStyles.avatarRingSelected, ringStyle]}>
          {member.avatarUrl ? (
            <ExpoImage
              recyclingKey={member.id}
              source={{ uri: member.avatarUrl }}
              style={galleryStyles.avatarImg}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={0}
            />
          ) : (
            <View style={galleryStyles.avatarPlaceholder}>
              <Ionicons name="person" size={30} color={colors.textMuted} />
            </View>
          )}
          {showSpinner ? (
            <View style={galleryStyles.avatarSpinner}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null}
        </Animated.View>
        <Text style={[galleryStyles.name, active && galleryStyles.nameSelected]} numberOfLines={2}>
          {member.name}
        </Text>
      </Pressable>
    </View>
  );
}

function StaffBookingGallery({
  staffList,
  selectedId,
  pendingId,
  contextLoading,
  onSelectStaff,
  onWarmStaffContext,
}: {
  staffList: CatalogStaffMember[];
  selectedId: string | null | undefined;
  pendingId: string | null;
  contextLoading: boolean;
  onSelectStaff: (id: string) => void;
  onWarmStaffContext?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const isActive = (id: string) => selectedId === id || pendingId === id;

  if (staffList.length === 0) {
    return (
      <View style={galleryStyles.emptyWrap}>
        <EmptyState message={t('booking.noStaff')} icon="people-outline" />
      </View>
    );
  }

  return (
    <View style={galleryStyles.section}>
      <Text style={galleryStyles.sectionTitle}>{t('booking.chooseBarber')}</Text>
      <Text style={galleryStyles.sectionHint}>{t('booking.tapPhotoHint')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        scrollEventThrottle={16}
        decelerationRate="normal"
        contentContainerStyle={galleryStyles.scrollContent}
        style={galleryStyles.scroll}
      >
        {staffList.map((s) => {
          const active = isActive(s.id);
          const showSpinner = pendingId === s.id && contextLoading && selectedId !== s.id;
          return (
            <StaffGalleryTile
              key={s.id}
              member={s}
              active={active}
              showSpinner={showSpinner}
              onSelect={onSelectStaff}
              onWarmStaffContext={onWarmStaffContext}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

function BookingSelectionRow({
  label,
  value,
  placeholder = false,
  disabled = false,
  onPress,
  onPressIn,
  avatarUrl,
}: {
  label: string;
  value: string;
  placeholder?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Warm data before the tap completes (e.g. slot list before the time sheet opens). */
  onPressIn?: () => void;
  avatarUrl?: string;
}) {
  return (
    <View style={bookingStyles.selectionBlock}>
      <Text style={bookingStyles.selectionLabel}>{label}</Text>
      <TouchableOpacity
        style={[
          bookingStyles.selectionPill,
          disabled && bookingStyles.selectionPillDisabled,
          !disabled && placeholder && bookingStyles.selectionPillReady,
        ]}
        onPress={onPress}
        onPressIn={onPressIn}
        disabled={disabled}
        activeOpacity={0.85}
      >
        <Text style={[bookingStyles.selectionValue, placeholder && bookingStyles.selectionValuePlaceholder]} numberOfLines={1}>
          {value}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        {avatarUrl ? (
          <View style={bookingStyles.selectionAvatar}>
            <ExpoImage
              source={{ uri: avatarUrl }}
              style={bookingStyles.selectionAvatarImage}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={0}
            />
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  );
}

type BookingConfirmSummaryRow = { key: string; label: string; value: string };

function BookingConfirmModal({
  visible,
  onClose,
  summaryRows,
  onSubmit,
  submitting,
  canSubmit,
  headingText,
  buttonTitle,
  showRewardToggle,
  rewardExpiresAt,
  useReward,
  onToggleReward,
}: {
  visible: boolean;
  onClose: () => void;
  summaryRows: BookingConfirmSummaryRow[];
  onSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
  headingText: string;
  buttonTitle: string;
  showRewardToggle?: boolean;
  rewardExpiresAt?: string | null;
  useReward?: boolean;
  onToggleReward?: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const disabled = submitting || !canSubmit;
  // rewardExpiresAt is an exclusive boundary (first instant no longer valid) -- subtract a day to
  // show the customer the last actual usable date.
  const rewardExpiresLabel = rewardExpiresAt
    ? formatDateDmy(new Date(new Date(rewardExpiresAt).getTime() - 24 * 60 * 60 * 1000))
    : '';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={bookingStyles.confirmRoot}>
        <Pressable style={bookingStyles.confirmBackdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={bookingStyles.confirmSheet}>
          <View style={bookingStyles.sheetHandle} />
          <View style={bookingStyles.confirmHeader}>
            <TouchableOpacity
              style={bookingStyles.confirmClose}
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={iconSize.lg + 2} color={colors.text} />
            </TouchableOpacity>
            <Text style={bookingStyles.confirmTitle} numberOfLines={2}>
              {headingText}
            </Text>
            <Text style={bookingStyles.confirmSubtitle}>{t('booking.confirmSummaryCaption')}</Text>
          </View>

          <View style={bookingStyles.confirmBody}>
            <View style={bookingStyles.confirmSummaryList}>
              {summaryRows.length === 0 ? (
                <View style={bookingStyles.confirmSummaryRowInline}>
                  <Text style={bookingStyles.confirmSummaryText}>—</Text>
                </View>
              ) : (
                summaryRows.map((row, index) => (
                  <View
                    key={row.key}
                    style={[
                      bookingStyles.confirmSummaryRowInline,
                      index < summaryRows.length - 1 && bookingStyles.confirmRowHairline,
                    ]}
                  >
                    <Text style={bookingStyles.confirmRowLabelInline}>{row.label}</Text>
                    <Text style={bookingStyles.confirmRowValueInline} numberOfLines={2}>
                      {row.value}
                    </Text>
                  </View>
                ))
              )}
            </View>

            {showRewardToggle ? (
              <View style={bookingStyles.rewardRow}>
                <View style={bookingStyles.rewardTextCol}>
                  <Text style={bookingStyles.rewardTitle}>{t('booking.birthdayRewardToggleTitle')}</Text>
                  <Text style={bookingStyles.rewardBody}>
                    {t('booking.birthdayRewardToggleBody', { date: rewardExpiresLabel })}
                  </Text>
                </View>
                <Switch
                  value={!!useReward}
                  onValueChange={onToggleReward}
                  trackColor={{ false: colors.border, true: colors.accent + '77' }}
                  thumbColor={useReward ? colors.accent : colors.surface}
                  ios_backgroundColor={colors.border}
                />
              </View>
            ) : null}
          </View>

          <View style={bookingStyles.confirmFooter}>
            <AppButton
              title={buttonTitle}
              onPress={onSubmit}
              variant="primary"
              compact
              disabled={disabled}
              loading={submitting}
              style={[bookingStyles.confirmBtn, disabled && bookingStyles.confirmBtnDisabled]}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function BookingScreen() {
  const { t } = useTranslation();
  const { localeTag, locale } = useAppLocale();
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void; openDrawer?: () => void; setParams: (p: Partial<RootDrawerParamList['Booking']>) => void }>();
  const route = useRoute<RouteProp<RootDrawerParamList, 'Booking'>>();
  const { isLoggedIn, token } = useAuth();
  const booking = useBooking(token);
  const lastStaffRevalidateAtRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (token) {
        syncCustomerPrefetchToken(token);
        /** Re-verify the real appointment count on every visit — fields stay inert
         * (appointmentLimitChecked=false) until this resolves, so the limit can never be judged
         * against a stale cache. */
        booking.actions.checkAppointmentLimit(token);
      }
      /** Avoid stacking parallel `/catalog/staff/bookable` refetches on quick tab switches (can overload JS thread). */
      const now = Date.now();
      if (now - lastStaffRevalidateAtRef.current < 2500) return;
      lastStaffRevalidateAtRef.current = now;
      void revalidateBookableStaffList().catch(() => undefined);
    }, [token, booking.actions.checkAppointmentLimit]),
  );

  const [prefMorning, setPrefMorning] = useState(false);
  const [prefAfternoon, setPrefAfternoon] = useState(false);
  const [prefEvening, setPrefEvening] = useState(false);
  const [showBookingSuccess, setShowBookingSuccess] = useState(false);
  const [bookingSuccessWasEdit, setBookingSuccessWasEdit] = useState(false);
  const [pendingStaffId, setPendingStaffId] = useState<string | null>(null);
  const bookingScrollRef = useRef<ScrollView>(null);
  const lastScrolledStaffKeyRef = useRef<string | null>(null);

  const {
    state: {
      staffList,
      catalogLoading,
      staffContextLoading,
      contextError,
      branches,
      branch,
      staffMember,
      service,
      selectedDate,
      selectedTime,
      slots,
      slotsLoading,
      submitting,
      canSelectDate,
      canProceedToTime,
      bookingDayOptions,
      staffHasWorkingDays,
      slotsNotWorkDay,
      canJoinWaitlist,
      waitlistStaffDayEnded,
      waitlistSubmitting,
      requiresBranchChoice,
      services,
      editingAppointmentId,
      atFutureAppointmentLimit,
      appointmentLimitChecked,
    },
    actions: {
      setBranch,
      setService,
      setSelectedDate,
      setSelectedTime,
      applyStaffById,
      warmStaffBookingContext,
      primeSlotsForDate,
      handleConfirm,
      joinWaitlist,
      reset,
      beginReschedule,
      beginWaitlistOfferFromId,
    },
    modals: mod,
  } = booking;

  /** Redemption is only offered for a brand-new booking, never a reschedule — same scoping as the
   * backend, which only wires this flag from the plain create endpoint. */
  const { rewardStatus, useReward, setUseReward } = useBirthdayReward(editingAppointmentId ? null : token);

  const {
    setShowBranchModal,
    setShowServiceModal,
    setShowDateModal,
    setShowTimeModal,
    setShowConfirmModal,
  } = mod;

  /** New bookings only: two future appointments — block branch/service/day/time and any open sheets.
   * Fails closed: also blocked while the server hasn't confirmed the real count yet, so fields can
   * never be usable based on a stale/unverified local cache. */
  const bookingBlockedByLimit = (!appointmentLimitChecked || atFutureAppointmentLimit) && !editingAppointmentId;

  useEffect(() => {
    if (!bookingBlockedByLimit) return;
    setShowBranchModal(false);
    setShowServiceModal(false);
    setShowDateModal(false);
    setShowTimeModal(false);
    setShowConfirmModal(false);
  }, [bookingBlockedByLimit, setShowBranchModal, setShowServiceModal, setShowDateModal, setShowTimeModal, setShowConfirmModal]);


  useFocusEffect(
    useCallback(() => {
      return () => {
        reset();
        setPrefMorning(false);
        setPrefAfternoon(false);
        setPrefEvening(false);
        setShowBookingSuccess(false);
        setBookingSuccessWasEdit(false);
      };
    }, [reset]),
  );

  useEffect(() => {
    setPrefMorning(false);
    setPrefAfternoon(false);
    setPrefEvening(false);
  }, [staffMember?.id, selectedDate?.toDateString()]);

  useEffect(() => {
    if (!showBookingSuccess) return;
    const navTimeout = setTimeout(() => {
      setShowBookingSuccess(false);
      navigation.navigate('Appointments');
    }, BOOKING_SUCCESS_NAV_DELAY_MS);
    return () => clearTimeout(navTimeout);
  }, [showBookingSuccess, navigation]);

  useEffect(() => {
    const p = route.params?.editAppointment;
    if (!p) return;
    if (!token) {
      navigation.setParams({ editAppointment: undefined });
      return;
    }
    navigation.setParams({ editAppointment: undefined });
    void beginReschedule(p);
  }, [route.params?.editAppointment?.appointmentId, beginReschedule, navigation, token]);

  /** Push notification: waitlist slot opened — verify offer and pre-fill staff / service / date / time. */
  useEffect(() => {
    const offerId = route.params?.waitlistOfferId;
    if (!offerId || !token) return;
    navigation.setParams({ waitlistOfferId: undefined });
    void beginWaitlistOfferFromId(offerId, token);
  }, [route.params?.waitlistOfferId, token, beginWaitlistOfferFromId, navigation]);

  /** Team screen (etc.) passes a barber id to pre-fill the booking flow. */
  useEffect(() => {
    const id = route.params?.initialStaffId;
    if (!id) return;
    if (!token) {
      navigation.setParams({ initialStaffId: undefined });
      return;
    }
    if (route.params?.editAppointment) {
      navigation.setParams({ initialStaffId: undefined });
      return;
    }
    navigation.setParams({ initialStaffId: undefined });
    setPendingStaffId(id);
    void applyStaffById(id).finally(() => setPendingStaffId(null));
  }, [route.params?.initialStaffId, route.params?.editAppointment, applyStaffById, navigation, token]);

  /** After choosing / switching staff, snap scroll once so the form is on-screen. */
  useLayoutEffect(() => {
    const id = staffMember?.id ?? pendingStaffId ?? null;
    if (!id) {
      lastScrolledStaffKeyRef.current = null;
      return;
    }
    if (id === lastScrolledStaffKeyRef.current) return;
    lastScrolledStaffKeyRef.current = id;
    let raf2: ReturnType<typeof requestAnimationFrame> | undefined;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        bookingScrollRef.current?.scrollToEnd({ animated: true });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== undefined) cancelAnimationFrame(raf2);
    };
  }, [staffMember?.id, pendingStaffId]);

  const hasAnyWaitlistPref = prefMorning || prefAfternoon || prefEvening;

  const waitlistPrefsInvalid = useMemo(() => {
    if (!staffMember?.workingDays?.length || !selectedDate) return false;
    if (!hasAnyWaitlistPref) return true;
    const dow = selectedDate.getDay();
    const wd = staffMember.workingDays.find((w) => w.dayOfWeek === dow);
    if (!wd) return true;
    const startMins = timeToMins(wd.startTime.slice(0, 5));
    const endMins = timeToMins(wd.endTime.slice(0, 5));
    if (startMins >= endMins) return true;
    return !prefsOverlapStaffWindow(prefMorning, prefAfternoon, prefEvening, startMins, endMins);
  }, [staffMember, selectedDate, prefMorning, prefAfternoon, prefEvening, hasAnyWaitlistPref]);

  const handleSelectStaff = useCallback(
    (id: string) => {
      if (!token || !isLoggedIn) {
        navigation.navigate('Login');
        return;
      }
      setPendingStaffId(id);
      void applyStaffById(id).finally(() => setPendingStaffId(null));
      /** Re-verify right when staff is picked too, not just on navigation focus — covers a retry
       * that never left this screen (e.g. re-picking staff after an earlier rejected attempt). */
      booking.actions.checkAppointmentLimit(token);
    },
    [applyStaffById, token, isLoggedIn, navigation, booking.actions.checkAppointmentLimit],
  );

  const canConfirm = !!(
    branch &&
    staffMember &&
    service &&
    selectedDate &&
    selectedTime &&
    appointmentLimitChecked &&
    !atFutureAppointmentLimit
  );

  const headerTitle = editingAppointmentId ? t('booking.editTitle') : t('booking.title');
  const confirmCta = editingAppointmentId ? t('booking.confirmUpdate') : t('booking.confirmBook');
  const confirmHeading = editingAppointmentId ? t('booking.confirmHeadingEdit') : t('booking.confirmHeadingBook');

  const onConfirm = async () => {
    if (!isLoggedIn || !token) {
      queueMicrotask(() => Alert.alert(t('booking.needLoginTitle'), t('booking.needLoginMsg')));
      navigation.navigate('Login');
      return;
    }
    if (!canConfirm) return;
    const wasEdit = !!editingAppointmentId;
    /** Wait for the server's real answer before claiming success — the customer's true
     * appointment count (e.g. the 2-future-appointments limit) is only known for certain here. */
    const result = await handleConfirm(token, { useBirthdayReward: !wasEdit && useReward });
    if (result.success) {
      setBookingSuccessWasEdit(wasEdit);
      setShowBookingSuccess(true);
    } else if (result.error) {
      queueMicrotask(() => Alert.alert(t('common.error'), result.error));
    }
  };

  const confirmSummaryRows: BookingConfirmSummaryRow[] = useMemo(() => {
    if (!selectedDate || !selectedTime || !service || !staffMember || !branch) return [];
    return [
      { key: 'day', label: t('booking.day'), value: formatDateWithWeekday(selectedDate, localeTag) },
      { key: 'time', label: t('booking.time'), value: selectedTime },
      { key: 'service', label: t('booking.service'), value: pickLocalizedName(service, locale) },
      { key: 'branch', label: t('booking.branch'), value: pickLocalizedName(branch, locale) },
      { key: 'staff', label: t('booking.confirmSummaryStaff'), value: staffMember.name },
    ];
  }, [selectedDate, selectedTime, service, staffMember, branch, localeTag, locale, t]);

  if (!isLoggedIn || !token) {
    return (
      <Screen noPadding style={{ backgroundColor: colors.surface }}>
        <BlackHeader
          title={headerTitle}
          onBackPress={() => navigation.navigate('Home')}
          onMenuPress={() => openDrawer(navigation)}
        />
        <ScrollView
          contentContainerStyle={[presets.scrollContent, styles.scrollContentTop, styles.guestScroll]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          scrollEventThrottle={16}
        >
          <ScreenEnter
            replayOnFocus
            variant="rise"
            durationMs={TEAM_SCREEN_ENTER_MS}
            riseFromY={TEAM_SCREEN_ENTER_RISE_FROM_Y}
          >
            <PageIntro compact title={t('booking.pageTitle')} />
            <EmptyState
              title={t('booking.needLoginTitle')}
              message={t('booking.needLoginMsg')}
              icon="lock-closed-outline"
            />
            <AppButton title={t('home.loginCta')} onPress={() => navigation.navigate('Login')} style={styles.guestLoginBtn} />
          </ScreenEnter>
        </ScrollView>
      </Screen>
    );
  }

  if (catalogLoading) {
    return (
      <Screen noPadding style={{ backgroundColor: colors.surface }}>
        <BlackHeader title={headerTitle} onBackPress={() => navigation.navigate('Home')} onMenuPress={() => openDrawer(navigation)} />
        <ScreenEnter
          replayOnFocus
          variant="rise"
          durationMs={TEAM_SCREEN_ENTER_MS}
          riseFromY={TEAM_SCREEN_ENTER_RISE_FROM_Y}
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}
        >
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={textStyles.bodySmall}>{t('booking.loadingStaff')}</Text>
        </ScreenEnter>
      </Screen>
    );
  }

  const staffPicked = !!(staffMember || pendingStaffId);

  return (
    <Screen noPadding style={{ backgroundColor: colors.surface }}>
      <BlackHeader title={headerTitle} onBackPress={() => navigation.navigate('Home')} onMenuPress={() => openDrawer(navigation)} />
      <ScrollView
        ref={bookingScrollRef}
        style={styles.scrollView}
        contentContainerStyle={[presets.scrollContent, styles.scrollContentTop]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        nestedScrollEnabled
        scrollEventThrottle={16}
        decelerationRate="normal"
      >
        <ScreenEnter
          replayOnFocus
          variant="rise"
          durationMs={TEAM_SCREEN_ENTER_MS}
          riseFromY={TEAM_SCREEN_ENTER_RISE_FROM_Y}
        >
          <PageIntro compact title={t('booking.pageTitle')} />

          <StaffBookingGallery
          staffList={staffList}
          selectedId={staffMember?.id ?? pendingStaffId ?? undefined}
          pendingId={pendingStaffId}
          contextLoading={staffContextLoading}
          onSelectStaff={handleSelectStaff}
          onWarmStaffContext={warmStaffBookingContext}
        />

        {contextError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={20} color={colors.danger} />
            <Text style={styles.errorBannerText}>{contextError}</Text>
          </View>
        ) : null}

        {appointmentLimitChecked && atFutureAppointmentLimit && !editingAppointmentId ? (
          <View style={styles.limitBanner}>
            <Ionicons name="information-circle" size={20} color={colors.accent} />
            <Text style={styles.limitBannerText}>{t('booking.maxFutureAppointments')}</Text>
          </View>
        ) : null}

        <View style={styles.nextSection}>
          <Text style={styles.nextSectionTitle}>{t('booking.detailsSection')}</Text>
        </View>

        <BookingSelectionRow
          label={t('booking.branch')}
          value={
            !staffPicked
              ? t('booking.pickStaffFirst')
              : staffContextLoading && branches.length === 0
                ? t('common.loading')
                : branches.length === 0
                  ? t('booking.dash')
                  : !requiresBranchChoice
                    ? (branch ? pickLocalizedName(branch, locale) : '') || t('booking.dash')
                    : (branch ? pickLocalizedName(branch, locale) : '') || t('booking.pickBranch')
          }
          placeholder={staffPicked && requiresBranchChoice && !branch}
          disabled={!staffPicked || !requiresBranchChoice || branches.length === 0 || bookingBlockedByLimit}
          onPress={() => {
            if (bookingBlockedByLimit) return;
            if (staffPicked && requiresBranchChoice && branches.length > 0) setShowBranchModal(true);
          }}
        />
        <BookingSelectionRow
          label={t('booking.service')}
          value={service ? pickLocalizedName(service, locale) : t('booking.pickService')}
          placeholder={!service}
          disabled={!staffPicked || !branch || bookingBlockedByLimit}
          onPress={() => {
            if (bookingBlockedByLimit) return;
            setShowServiceModal(true);
          }}
        />
        <BookingSelectionRow
          label={t('booking.day')}
          value={
            selectedDate
              ? formatDateWithWeekday(selectedDate, localeTag)
              : t('booking.pickDay')
          }
          placeholder={!selectedDate}
          disabled={!canSelectDate || bookingBlockedByLimit}
          onPress={() => {
            if (bookingBlockedByLimit) return;
            setShowDateModal(true);
          }}
        />
        <BookingSelectionRow
          label={t('booking.time')}
          value={selectedTime ?? t('booking.pickTime')}
          placeholder={!selectedTime}
          disabled={!canProceedToTime || bookingBlockedByLimit}
          onPressIn={() => {
            if (bookingBlockedByLimit) return;
            if (canProceedToTime && selectedDate) primeSlotsForDate(selectedDate);
          }}
          onPress={() => {
            if (bookingBlockedByLimit) return;
            if (canProceedToTime) setShowTimeModal(true);
          }}
        />

        {canConfirm ? (
          <View style={styles.confirmButtonWrap}>
            <AppButton
              title={confirmCta}
              onPress={() => mod.setShowConfirmModal(true)}
              variant="primary"
              style={styles.confirmButton}
            />
          </View>
        ) : null}
        </ScreenEnter>
      </ScrollView>

      <BottomSheetModal visible={mod.showBranchModal} onClose={() => mod.setShowBranchModal(false)} title={t('booking.sheetBranch')}>
        {branches.length === 0 ? (
          <EmptyState message={t('booking.noBranches')} icon="business-outline" />
        ) : (
          branches.map((b) => (
            <TouchableOpacity
              key={b.id}
              style={[styles.choiceCard, branch?.id === b.id && styles.choiceCardSelected]}
              onPress={() => {
                setBranch(b);
                mod.setShowBranchModal(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.choiceCardText, branch?.id === b.id && styles.choiceCardTextSelected]}>
                {pickLocalizedName(b, locale)}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </BottomSheetModal>

      <BottomSheetModal visible={mod.showServiceModal} onClose={() => mod.setShowServiceModal(false)} title={t('booking.sheetService')}>
        {!staffMember ? (
          <EmptyState message={t('booking.pickStaffFirstShort')} icon="person-outline" />
        ) : services.length === 0 ? (
          <EmptyState message={t('booking.noServicesStaff')} icon="cut-outline" />
        ) : (
          services.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={[styles.serviceChoiceCard, service?.id === s.id && styles.choiceCardSelected]}
            onPress={() => {
              setService(s);
              mod.setShowServiceModal(false);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.choiceCardText, service?.id === s.id && styles.choiceCardTextSelected]}>
              {pickLocalizedName(s, locale)}
            </Text>
            <View style={styles.serviceBadge}>
              <Text style={styles.serviceBadgeText}>₪{s.price}</Text>
            </View>
          </TouchableOpacity>
        ))
        )}
      </BottomSheetModal>

      <BottomSheetModal visible={mod.showDateModal} onClose={() => mod.setShowDateModal(false)} title={t('booking.sheetDay')}>
        {bookingDayOptions.length === 0 ? (
          <EmptyState message={t('booking.pickStaffForDays')} icon="calendar-outline" />
        ) : (
          <>
            {!staffHasWorkingDays ? (
              <Text style={styles.dayPickerBanner}>{t('booking.dayNoWorkingDays')}</Text>
            ) : null}
            {bookingDayOptions.map((row) => {
              const d = row.date;
              const dateStr = toDateString(d);
              const isSelected = !!(selectedDate && toDateString(selectedDate) === dateStr && row.available);
              return (
                <TouchableOpacity
                  key={dateStr}
                  disabled={!row.available}
                  style={[
                    styles.dayChoiceCard,
                    !row.available && styles.dayChoiceClosed,
                    !row.available && styles.dayChoiceCardWrap,
                    isSelected && styles.dayChoiceCardSelected,
                  ]}
                  onPressIn={() => {
                    if (row.available) primeSlotsForDate(d);
                  }}
                  onPress={() => {
                    if (!row.available) return;
                    setSelectedDate(d);
                    setSelectedTime(null);
                    primeSlotsForDate(d);
                    mod.setShowDateModal(false);
                  }}
                  activeOpacity={row.available ? 0.8 : 1}
                >
                  {!row.available && staffHasWorkingDays ? (
                    <View style={styles.dayUnavailableBadge} pointerEvents="none">
                      <Text style={styles.dayUnavailableBadgeText}>{t('booking.dayUnavailable')}</Text>
                    </View>
                  ) : null}
                  <Text
                    style={[
                      styles.dayChoiceWeekday,
                      !row.available && styles.dayChoiceClosedText,
                      isSelected && styles.dayChoiceWeekdaySelected,
                    ]}
                  >
                    {getWeekdayNameForYyyyMmDd(dateStr, localeTag)}
                  </Text>
                  <Text
                    style={[
                      styles.dayChoiceDate,
                      !row.available && styles.dayChoiceClosedText,
                      isSelected && styles.dayChoiceDateSelected,
                    ]}
                  >
                    {formatDateDmy(d)}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <Text style={styles.sheetNote}>{t('booking.daySheetNote')}</Text>
          </>
        )}
      </BottomSheetModal>

      <BottomSheetModal visible={mod.showTimeModal} onClose={() => mod.setShowTimeModal(false)} title={t('booking.sheetTime')}>
        {slotsLoading && slots.length === 0 ? (
          <View style={styles.emptySlotWrap}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.slotLoadingText}>{t('booking.slotLoading')}</Text>
          </View>
        ) : slots.length === 0 ? (
          <View style={styles.waitlistEmptyWrap}>
            <EmptyState
              message={slotsNotWorkDay ? t('booking.notWorkDay') : t('booking.noSlots')}
              icon="time-outline"
            />
            {!slotsNotWorkDay && waitlistStaffDayEnded ? (
              <Text style={styles.waitlistBlockedBanner}>{t('booking.waitlistDayEnded')}</Text>
            ) : null}
            {canJoinWaitlist && !slotsNotWorkDay && !bookingBlockedByLimit ? (
              <View style={styles.waitlistCard}>
                <View style={styles.waitlistCardHeader}>
                  <Ionicons name="notifications-outline" size={22} color={colors.accent} />
                  <Text style={styles.waitlistCardTitle}>{t('booking.waitlistTitle')}</Text>
                </View>
                <Text style={styles.waitlistCardDesc}>{t('booking.waitlistDesc')}</Text>
                <Text style={styles.waitlistPrefsLabel}>{t('booking.waitlistWhenLabel')}</Text>
                <View style={styles.waitlistChips}>
                  {(
                    [
                      { key: 'm', label: t('booking.morning'), on: prefMorning, set: setPrefMorning },
                      { key: 'a', label: t('booking.afternoon'), on: prefAfternoon, set: setPrefAfternoon },
                      { key: 'e', label: t('booking.evening'), on: prefEvening, set: setPrefEvening },
                    ] as const
                  ).map(({ key, label, on, set }) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.waitlistChip, on && styles.waitlistChipOn]}
                      onPress={() => set(!on)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.waitlistChipText, on && styles.waitlistChipTextOn]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {!isLoggedIn ? (
                  <TouchableOpacity style={styles.waitlistLoginBtn} onPress={() => { mod.setShowTimeModal(false); navigation.navigate('Login'); }} activeOpacity={0.9}>
                    <Text style={styles.waitlistLoginBtnText}>{t('booking.waitlistLogin')}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.waitlistJoinBtn,
                      (waitlistSubmitting || waitlistPrefsInvalid) && styles.waitlistJoinBtnDisabled,
                    ]}
                    disabled={waitlistSubmitting || waitlistPrefsInvalid}
                    onPress={async () => {
                      if (!token) return;
                      const r = await joinWaitlist(token, {
                        preferMorning: prefMorning,
                        preferAfternoon: prefAfternoon,
                        preferEvening: prefEvening,
                      });
                      if (r.success) {
                        mod.setShowTimeModal(false);
                        navigation.navigate('Appointments');
                      } else {
                        Alert.alert(t('booking.failed'), r.error ?? '');
                      }
                    }}
                    activeOpacity={0.9}
                  >
                    {waitlistSubmitting ? (
                      <ActivityIndicator color={colors.onPrimary} />
                    ) : (
                      <Text style={styles.waitlistJoinBtnText}>{t('booking.waitlistJoin')}</Text>
                    )}
                  </TouchableOpacity>
                )}
                {waitlistPrefsInvalid ? (
                  <Text style={styles.waitlistPrefsWarning}>
                    {hasAnyWaitlistPref ? t('booking.waitlistPrefsWarning') : t('booking.waitlistPrefsRequired')}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : (
          slots.map((slotTime) => (
            <TouchableOpacity
              key={slotTime}
              style={[styles.timeChoiceCard, selectedTime === slotTime && styles.timeChoiceCardSelected]}
              onPress={() => {
                setSelectedTime(slotTime);
                mod.setShowTimeModal(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.timeChoiceCardText, selectedTime === slotTime && styles.timeChoiceCardTextSelected]}>{slotTime}</Text>
            </TouchableOpacity>
          ))
        )}
      </BottomSheetModal>

      <BookingConfirmModal
        visible={mod.showConfirmModal}
        onClose={() => mod.setShowConfirmModal(false)}
        summaryRows={confirmSummaryRows}
        onSubmit={onConfirm}
        submitting={submitting}
        canSubmit={canConfirm}
        headingText={confirmHeading}
        buttonTitle={confirmCta}
        showRewardToggle={!editingAppointmentId && rewardStatus.active}
        rewardExpiresAt={rewardStatus.expiresAt}
        useReward={useReward}
        onToggleReward={setUseReward}
      />

      {/*
        In-screen overlay (not RN Modal): a second Modal here has caused the booking screen to
        stay visible but ignore all touches on some devices after success / navigation.
      */}
      {showBookingSuccess ? (
        <Animated.View
          entering={FadeIn.duration(280).easing(LAYOUT_EASE_OUT_SMOOTH)}
          style={styles.bookingSuccessOverlayRoot}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          accessibilityViewIsModal
        >
          <View style={styles.bookingSuccessDimmer}>
            <View style={styles.bookingSuccessCard}>
              <View style={styles.bookingSuccessCircle}>
                <Ionicons name="checkmark" size={48} color={colors.success} />
              </View>
              <Text style={styles.bookingSuccessTitle}>
                {bookingSuccessWasEdit ? t('booking.successUpdated') : t('booking.successBooked')}
              </Text>
              <Text style={styles.bookingSuccessSub}>{t('booking.successSubtitle')}</Text>
            </View>
          </View>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scrollView: { flex: 1 },
  scrollContentTop: {},
  guestScroll: {
    flexGrow: 1,
    paddingBottom: layout.screenPaddingBottom,
  },
  guestLoginBtn: {
    marginTop: spacing.lg,
    alignSelf: 'stretch',
  },
  errorBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerMuted,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    marginHorizontal: layout.screenPaddingH,
  },
  errorBannerText: {
    flex: 1,
    ...textStyles.bodySmall,
    color: colors.danger,
    textAlign: 'right',
    lineHeight: 20,
  },
  limitBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.accent + '14',
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    marginHorizontal: layout.screenPaddingH,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent + '44',
  },
  limitBannerText: {
    flex: 1,
    ...textStyles.bodySmall,
    color: colors.text,
    textAlign: 'right',
    lineHeight: 20,
    writingDirection: 'rtl',
  },
  nextSection: {
    marginHorizontal: layout.screenPaddingH,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  nextSectionTitle: {
    ...textStyles.sectionTitle,
    fontSize: 15,
    textAlign: 'right',
    color: colors.text,
  },
  contextLoadingBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    justifyContent: 'center',
  },
  contextLoadingText: {
    ...textStyles.bodySmall,
    color: colors.accent,
    fontWeight: '600',
  },
  confirmButtonWrap: { alignItems: 'center', marginVertical: spacing.md, marginHorizontal: layout.screenPaddingH },
  confirmButton: {
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignSelf: 'center',
    minWidth: 200,
    maxWidth: 320,
    minHeight: 48,
  },
  choiceCard: {
    width: '100%',
    maxWidth: 210,
    minHeight: 58,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.xs + 4,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm - 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
    shadowOpacity: 0.04,
    elevation: 1,
  },
  choiceCardSelected: { borderColor: colors.accent, borderWidth: 2 },
  choiceCardText: {
    ...textStyles.body,
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '600',
  },
  choiceCardTextSelected: { color: colors.accent, fontWeight: '700' },
  serviceChoiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 210,
    minHeight: 58,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.xs + 4,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm - 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...shadows.card,
    shadowOpacity: 0.04,
    elevation: 1,
  },
  serviceBadge: {
    backgroundColor: colors.primary,
    minWidth: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  serviceBadgeText: { color: colors.onPrimary, fontSize: 12, fontWeight: '700' },
  timeChoiceCard: {
    width: '100%',
    maxWidth: 210,
    minHeight: 58,
    alignSelf: 'center',
    marginBottom: spacing.sm - 2,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.xs + 4,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...shadows.card,
    shadowOpacity: 0.04,
    elevation: 1,
  },
  timeChoiceCardSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  timeChoiceCardText: { fontSize: 14, color: colors.text, fontWeight: '700' },
  timeChoiceCardTextSelected: { color: colors.onPrimary, fontWeight: '700' },
  sheetNote: {
    ...textStyles.caption,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  dayPickerBanner: {
    fontSize: 13,
    color: colors.danger,
    textAlign: 'right',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
    lineHeight: 20,
  },
  dayChoiceCardWrap: {
    position: 'relative',
    overflow: 'hidden',
    paddingTop: spacing.sm + 8,
  },
  dayChoiceCard: {
    width: '100%',
    maxWidth: 210,
    minHeight: 58,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.xs + 4,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm - 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
    shadowOpacity: 0.04,
    elevation: 1,
  },
  dayChoiceCardSelected: {
    borderColor: colors.accent,
    borderWidth: 2,
  },
  dayChoiceClosed: {
    opacity: 0.88,
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  dayChoiceWeekday: {
    ...textStyles.caption,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 2,
    writingDirection: 'rtl',
  },
  dayChoiceWeekdaySelected: {
    color: colors.accent,
    fontWeight: '700',
  },
  dayChoiceDate: {
    ...textStyles.body,
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '700',
    color: colors.text,
  },
  dayChoiceDateSelected: {
    color: colors.accent,
  },
  dayChoiceClosedText: {
    color: colors.textMuted,
  },
  /** Small label — top-right of card (visual); pointerEvents none on wrapper */
  dayUnavailableBadge: {
    position: 'absolute',
    top: 5,
    right: 8,
    zIndex: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
  dayUnavailableBadgeText: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
  emptySlotWrap: { width: '100%', alignItems: 'center', padding: spacing.xl },
  slotLoadingText: { fontSize: 14, color: colors.textMuted, marginTop: spacing.sm },
  waitlistEmptyWrap: { width: '100%', paddingBottom: spacing.lg },
  waitlistCard: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.accent + '44',
  },
  waitlistCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm, marginBottom: spacing.sm },
  waitlistCardTitle: { ...textStyles.sectionTitle, fontSize: 17, fontWeight: '800' },
  waitlistCardDesc: {
    ...textStyles.caption,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  waitlistPrefsLabel: { ...textStyles.bodySmall, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  waitlistChips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginBottom: spacing.lg },
  waitlistChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  waitlistChipOn: { borderColor: colors.accent, backgroundColor: colors.accent + '18' },
  waitlistChipText: { fontSize: 14, color: colors.textMuted, fontWeight: '600' },
  waitlistChipTextOn: { color: colors.accent },
  waitlistLoginBtn: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  waitlistLoginBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
  waitlistJoinBtn: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  waitlistJoinBtnDisabled: { opacity: 0.65 },
  waitlistJoinBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
  waitlistBlockedBanner: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'right',
    lineHeight: 22,
    fontWeight: '600',
  },
  waitlistPrefsWarning: {
    marginTop: spacing.sm,
    ...textStyles.caption,
    fontSize: 13,
    color: colors.warning,
    lineHeight: 20,
  },
  /** Full-screen layer above booking content (avoids native Modal touch bugs). */
  bookingSuccessOverlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    elevation: 2000,
  },
  bookingSuccessDimmer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  bookingSuccessCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl + spacing.sm,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    ...shadows.card,
    shadowOpacity: 0.12,
    elevation: 8,
  },
  bookingSuccessCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: colors.success,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  bookingSuccessTitle: {
    ...textStyles.pageTitle,
    fontSize: 20,
    textAlign: 'center',
    marginBottom: spacing.sm,
    writingDirection: 'rtl',
  },
  bookingSuccessSub: {
    ...textStyles.bodySmall,
    textAlign: 'center',
    color: colors.textSecondary,
    lineHeight: 22,
    writingDirection: 'rtl',
  },
});

const bookingStyles = StyleSheet.create({
  selectionBlock: { marginBottom: spacing.md, alignSelf: 'center', width: '92%' },
  selectionLabel: { ...textStyles.label, marginBottom: spacing.xs, textAlign: 'right', writingDirection: 'rtl', fontSize: 12 },
  selectionPill: {
    minHeight: 48,
    backgroundColor: colors.surface,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...shadows.card,
    shadowOpacity: 0.06,
    elevation: 2,
    gap: 8,
  },
  selectionPillDisabled: { opacity: 0.5 },
  /** Just-became-tappable state (enabled, not yet chosen) — a soft accent-tinted border so it
   * reads as "ready to tap" instead of only differing from the disabled state by opacity. */
  selectionPillReady: {
    borderWidth: 1,
    borderColor: colors.accent + '66',
  },
  selectionValue: {
    flex: 1,
    ...textStyles.body,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  selectionValuePlaceholder: { color: colors.textMuted },
  selectionAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  selectionAvatarImage: { width: '100%', height: '100%' },
  confirmRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayLight,
  },
  confirmSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? 34 : spacing.lg,
    maxHeight: '82%',
    width: '100%',
    zIndex: 2,
    ...(Platform.OS === 'ios' ? shadows.sheet : { elevation: 24 }),
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.borderSubtle,
    borderRadius: radius.sm,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  confirmHeader: {
    position: 'relative',
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: spacing.sm,
  },
  confirmClose: {
    position: 'absolute',
    top: 0,
    end: 0,
    zIndex: 10,
    padding: spacing.sm,
    minWidth: layout.hitMin,
    minHeight: layout.hitMin,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmTitle: {
    ...textStyles.sectionTitle,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: spacing.xxl + 4,
    paddingTop: spacing.xs,
    color: colors.text,
  },
  /** Muted caption under title — not gold `textStyles.label` */
  confirmSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    color: colors.textTertiary,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    writingDirection: 'rtl',
  },
  confirmBody: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: spacing.md,
  },
  /** One clean list: white inset card, hairlines only between rows */
  confirmSummaryList: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
    ...shadows.card,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  confirmSummaryRowInline: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.sm + 4,
    minHeight: 46,
    paddingVertical: spacing.sm + 2,
    paddingStart: spacing.md,
    paddingEnd: spacing.md,
  },
  confirmRowHairline: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  rewardRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.accent + '33',
    backgroundColor: colors.accent + '0f',
  },
  rewardTextCol: { flex: 1, alignItems: 'flex-end' },
  rewardTitle: {
    ...textStyles.bodyMedium,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
  },
  rewardBody: {
    ...textStyles.caption,
    color: colors.textSecondary,
    textAlign: 'right',
    marginTop: 2,
  },
  /** Label on the logical start (right in RTL) — read before the value */
  confirmRowLabelInline: {
    flexShrink: 0,
    minWidth: 76,
    maxWidth: '34%',
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  confirmRowValueInline: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    textAlign: 'right',
    color: colors.text,
    writingDirection: 'rtl',
  },
  confirmSummaryText: {
    ...textStyles.body,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    color: colors.textMuted,
    writingDirection: 'rtl',
    paddingVertical: spacing.md,
  },
  confirmFooter: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    borderTopWidth: 0,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  confirmBtn: {
    alignSelf: 'center',
    width: '82%',
    maxWidth: 280,
    borderRadius: radius.full,
  },
  confirmBtnDisabled: { opacity: 0.7 },
});
