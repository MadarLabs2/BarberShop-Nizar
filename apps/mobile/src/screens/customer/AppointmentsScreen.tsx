import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, TouchableOpacity, ActivityIndicator, DeviceEventEmitter, InteractionManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect, type NavigationProp } from '@react-navigation/native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { RootDrawerParamList } from '../../navigation/paramList';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { ShelfStaggerEnter } from '../../components/ui/ShelfStaggerEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { PageIntro } from '../../components/ui/PageIntro';
import { EmptyState } from '../../components/feedback/EmptyState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { AppointmentCard } from '../../components/cards/AppointmentCard';
import { AppButton } from '../../components/ui/AppButton';
import {
  cancelAppointment,
  getMyWaitlist,
  leaveWaitlist,
  type AppointmentDto,
  type MyWaitlistEntry,
} from '../../services/bookings.api';
import { drainWaitlistJoinQueue, mergeWaitlistEntries } from '../../lib/waitlistJoinQueue';
import {
  CUSTOMER_APPOINTMENTS_CACHE_WARMED,
  peekCustomerWaitlist,
  syncCustomerPrefetchToken,
} from '../../services/customerPrefetchCache';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useAppointments } from '../../contexts/AppointmentsContext';
import { useNotifications } from '../../contexts/NotificationsContext';
import { useBadgeSeen } from '../../contexts/BadgeSeenContext';
import { localizeCatalogString, useAppLocale } from '../../contexts/LocaleContext';
import { openDrawer } from '../../utils/nav';
import { formatDateDmy } from '../../utils/dates';
import { colors, spacing, presets, radius, textStyles, shadows } from '../../theme';

export function AppointmentsScreen() {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const navigation = useNavigation<NavigationProp<RootDrawerParamList>>();
  const { isLoggedIn, token } = useAuth();
  const {
    upcoming,
    past,
    loading,
    refreshing,
    hasLoadedOnce,
    refresh,
    forceRefresh,
    updateUpcoming,
    clearPastHistory,
  } = useAppointments();
  const { addLocalNotification, removeNotificationById } = useNotifications();
  const { markAppointmentsSeenFromLists } = useBadgeSeen();
  const formatWlPrefs = useCallback(
    (w: MyWaitlistEntry) => {
      const p: string[] = [];
      if (w.preferMorning) p.push(t('appointments.morning'));
      if (w.preferAfternoon) p.push(t('appointments.afternoon'));
      if (w.preferEvening) p.push(t('appointments.evening'));
      return p.join(' · ');
    },
    [t]
  );
  const [clearingPast, setClearingPast] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<string[]>([]);
  const [waitlist, setWaitlist] = useState<MyWaitlistEntry[]>([]);
  /** False until first waitlist fetch finishes — avoids showing "אין תורים" before we know about waitlist-only users. */
  const [waitlistReady, setWaitlistReady] = useState(false);
  const focusEnter = useSharedValue(1);

  const focusEnterStyle = useAnimatedStyle(() => ({
    opacity: 0.9 + focusEnter.value * 0.1,
    transform: [{ translateY: (1 - focusEnter.value) * 10 }],
  }));

  const loadWaitlist = useCallback(async () => {
    if (!token) {
      setWaitlist([]);
      setWaitlistReady(true);
      return;
    }
    const pending = drainWaitlistJoinQueue();
    try {
      const server = await getMyWaitlist(token);
      setWaitlist(mergeWaitlistEntries(pending, server));
    } catch {
      setWaitlist(pending.length ? pending : []);
    } finally {
      setWaitlistReady(true);
    }
  }, [token]);

  useLayoutEffect(() => {
    if (!token) {
      setWaitlist([]);
      setWaitlistReady(true);
      return;
    }
    syncCustomerPrefetchToken(token);
    const peek = peekCustomerWaitlist();
    if (peek !== null) {
      const pending = drainWaitlistJoinQueue();
      setWaitlist(mergeWaitlistEntries(pending, peek));
      setWaitlistReady(true);
    } else {
      setWaitlist([]);
      setWaitlistReady(false);
    }
  }, [token]);

  const markSeenRef = useRef(markAppointmentsSeenFromLists);
  markSeenRef.current = markAppointmentsSeenFromLists;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      focusEnter.value = 0;
      focusEnter.value = withTiming(1, { duration: 220 });
      const task = InteractionManager.runAfterInteractions(() => {
        (async () => {
          if (!token) return;
          const lists = await refresh(token, { silent: true });
          if (cancelled || !lists) return;
          void Promise.resolve(markSeenRef.current(lists.upcoming, lists.past)).catch(() => undefined);
        })();
        void loadWaitlist();
      });
      return () => {
        cancelled = true;
        task.cancel();
      };
    }, [token, refresh, loadWaitlist, focusEnter])
  );

  /** Prefetch writes `/bookings/my` cache as soon as it returns — hydrate list without waiting for slower bundle slices. */
  useEffect(() => {
    if (!token) return;
    const sub = DeviceEventEmitter.addListener(CUSTOMER_APPOINTMENTS_CACHE_WARMED, () => {
      void (async () => {
        const lists = await refresh(token, { silent: true });
        if (lists) void Promise.resolve(markSeenRef.current(lists.upcoming, lists.past)).catch(() => undefined);
      })();
    });
    return () => sub.remove();
  }, [token, refresh]);

  const onRefresh = useCallback(async () => {
    const result = await forceRefresh(token);
    if (result) await markAppointmentsSeenFromLists(result.upcoming, result.past);
    void loadWaitlist();
  }, [token, forceRefresh, markAppointmentsSeenFromLists, loadWaitlist]);

  const handleEditAppointment = useCallback(
    (item: AppointmentDto) => {
      if (!item.staffId || !item.branchId || !item.serviceId) {
        Alert.alert(t('appointments.editUnavailable'), t('appointments.editUnavailableMsg'));
        return;
      }
      navigation.navigate('Booking', {
        editAppointment: {
          appointmentId: item.id,
          staffId: item.staffId,
          branchId: item.branchId,
          serviceId: item.serviceId,
          date: item.date,
          time: item.time,
        },
      });
    },
    [navigation, t]
  );

  const handleCancel = (id: string) => {
    if (!token) return;
    if (cancellingIds.includes(id)) return;
    const removed = upcoming.find((a) => a.id === id);
    if (!removed) return;
    setCancellingIds((prev) => [...prev, id]);
    updateUpcoming((prev) => prev.filter((a) => a.id !== id));
    const localCancelNotifId = addLocalNotification({
      title: t('appointments.cancelledOk'),
      body: `${localizeCatalogString(removed.serviceName, locale)} - ${removed.date} ${removed.time}`,
      type: 'appointment',
      token,
    });
    // Show success immediately; server cancellation continues in background.
    Alert.alert(t('appointments.cancelledOk'), t('appointments.cancelledMsg'));
    void (async () => {
      try {
        await cancelAppointment(id, token);
      } catch (e) {
        removeNotificationById(localCancelNotifId, token);
        updateUpcoming((prev) => [...prev, removed].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
        Alert.alert(t('common.error'), e instanceof Error ? e.message : t('appointments.cancelFailed'));
      } finally {
        setCancellingIds((prev) => prev.filter((x) => x !== id));
      }
    })();
  };

  const handleClearPast = () => {
    if (!token || past.length === 0) return;
    Alert.alert(
      t('appointments.clearPastTitle'),
      t('appointments.clearPastMsg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('appointments.clearPastAction'),
          style: 'destructive',
          onPress: async () => {
            setClearingPast(true);
            try {
              await clearPastHistory(token);
            } catch (e) {
              Alert.alert(t('common.error'), e instanceof Error ? e.message : t('appointments.clearPastFailed'));
            } finally {
              setClearingPast(false);
            }
          },
        },
      ]
    );
  };

  const appointmentsHero = (
    <PageIntro compact showDivider={false} title={t('appointments.manageTitle')} />
  );

  if (!isLoggedIn || !token) {
    return (
      <Screen noPadding>
        <BlackHeader
          title={t('appointments.title')}
          onBackPress={() => navigation.navigate('Home')}
          onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
        />
        <ScrollView contentContainerStyle={[presets.scrollContent, styles.scrollContentTop, styles.guestScroll]}>
          <ScreenEnter variant="rise" style={styles.enterGrow}>
            <Animated.View style={[styles.enterGrow, focusEnterStyle]}>
              {appointmentsHero}
              <EmptyState
                title={t('appointments.needLoginTitle')}
                message={t('appointments.needLoginMsg')}
                icon="lock-closed-outline"
              />
            </Animated.View>
          </ScreenEnter>
        </ScrollView>
      </Screen>
    );
  }

  /** Full-screen spinner only on first appointments load (no cache yet). */
  if (loading && !hasLoadedOnce && upcoming.length === 0 && past.length === 0) {
    return (
      <Screen noPadding>
        <BlackHeader
          title={t('appointments.title')}
          onBackPress={() => navigation.navigate('Home')}
          onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
        />
        <ScreenEnter variant="rise" style={styles.enterFlex}>
          <Animated.View style={[styles.enterFlex, focusEnterStyle]}>
            <LoadingState />
          </Animated.View>
        </ScreenEnter>
      </Screen>
    );
  }

  /** Appointments loaded but waitlist still fetching — keep layout; no full-screen reload. */
  if (hasLoadedOnce && upcoming.length === 0 && past.length === 0 && !waitlistReady) {
    return (
      <Screen noPadding>
        <BlackHeader
          title={t('appointments.title')}
          onBackPress={() => navigation.navigate('Home')}
          onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
        />
        <ScrollView
          contentContainerStyle={[presets.scrollContent, styles.scrollContentTop, styles.waitlistHydrateScroll]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <ScreenEnter variant="rise" style={styles.enterGrow}>
            <Animated.View style={[styles.enterGrow, focusEnterStyle]}>
              {appointmentsHero}
              <View style={styles.waitlistHydrateRow} accessibilityRole="progressbar">
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.waitlistHydrateText}>{t('common.loading')}</Text>
              </View>
            </Animated.View>
          </ScreenEnter>
        </ScrollView>
      </Screen>
    );
  }

  if (upcoming.length === 0 && past.length === 0 && waitlist.length === 0 && waitlistReady) {
    return (
      <Screen noPadding>
        <BlackHeader
          title={t('appointments.title')}
          onBackPress={() => navigation.navigate('Home')}
          onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
        />
        <ScrollView
          contentContainerStyle={[presets.scrollContent, styles.scrollContentTop, styles.emptyContainer]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <ScreenEnter variant="rise" style={styles.enterGrow}>
            <Animated.View style={[styles.enterGrow, focusEnterStyle]}>
              {appointmentsHero}
              <EmptyState
                title={t('appointments.emptyTitle')}
                message={t('appointments.emptyMsg')}
                icon="calendar-outline"
              />
              <AppButton
                title={t('appointments.book')}
                onPress={() => navigation.navigate('Booking' as never)}
                style={styles.bookingCta}
              />
            </Animated.View>
          </ScreenEnter>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen noPadding>
      <BlackHeader
        title={t('appointments.title')}
        onBackPress={() => navigation.navigate('Home')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[presets.scrollContent, styles.scrollContentTop]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ScreenEnter variant="rise" style={styles.enterGrow}>
          <Animated.View style={[styles.enterGrow, focusEnterStyle]}>
            {appointmentsHero}
            {waitlist.length > 0 ? (
              <ShelfStaggerEnter index={0}>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{t('appointments.waitlistSection')}</Text>
                  {waitlist.map((w) => (
                    <View key={w.id} style={styles.wlCard}>
                      <View style={styles.wlTop}>
                        <Text style={styles.wlDate}>
                          {formatDateDmy(new Date(w.date + 'T12:00:00'))}{' '}
                          ·{' '}
                          {localizeCatalogString(w.serviceName, locale)}
                        </Text>
                        <TouchableOpacity
                          onPress={async () => {
                            if (!token) return;
                            try {
                              await leaveWaitlist(w.id, token);
                              setWaitlist((prev) => prev.filter((x) => x.id !== w.id));
                            } catch (e) {
                              Alert.alert(t('common.error'), e instanceof Error ? e.message : '');
                            }
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={t('appointments.waitlistLeaveA11y')}
                        >
                          <Ionicons name="close-circle-outline" size={22} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.wlSub}>
                        {w.staffName}
                        {w.branchName ? ` · ${localizeCatalogString(w.branchName, locale)}` : ''}
                      </Text>
                      <Text style={styles.wlPrefs}>{formatWlPrefs(w)}</Text>
                    </View>
                  ))}
                </View>
              </ShelfStaggerEnter>
            ) : null}
            {upcoming.length > 0 ? (
              <ShelfStaggerEnter index={waitlist.length > 0 ? 1 : 0}>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{t('appointments.upcoming')}</Text>
                  {upcoming.map((item) => (
                    <AppointmentCard
                      key={item.id}
                      item={item}
                      variant="list"
                      showPrice
                      onCancel={handleCancel}
                      onEdit={handleEditAppointment}
                      isCancelling={cancellingIds.includes(item.id)}
                    />
                  ))}
                </View>
              </ShelfStaggerEnter>
            ) : null}
            {past.length > 0 ? (
              <ShelfStaggerEnter index={(waitlist.length > 0 ? 1 : 0) + (upcoming.length > 0 ? 1 : 0)}>
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.pastSectionTitle}>{t('appointments.past')}</Text>
                    <TouchableOpacity
                      onPress={handleClearPast}
                      disabled={clearingPast}
                      style={styles.clearAllBtn}
                      accessibilityRole="button"
                      accessibilityLabel={t('appointments.clearPastA11y')}
                    >
                      <Text style={[styles.clearAllLabel, clearingPast && styles.clearAllLabelDisabled]}>
                        {t('appointments.clearAll')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {past.map((item) => (
                    <AppointmentCard
                      key={item.id}
                      item={item}
                      variant="list"
                      showPrice
                      isPast
                    />
                  ))}
                </View>
              </ShelfStaggerEnter>
            ) : null}
          </Animated.View>
        </ScreenEnter>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  enterFlex: { flex: 1 },
  enterGrow: { flexGrow: 1 },
  scrollContentTop: {},
  guestScroll: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingTop: spacing.xs,
  },
  scroll: { flex: 1 },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    paddingTop: spacing.xs,
  },
  waitlistHydrateScroll: {
    flexGrow: 1,
    paddingTop: spacing.xs,
  },
  waitlistHydrateRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  waitlistHydrateText: {
    ...textStyles.bodySmall,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  bookingCta: {
    marginTop: spacing.lg,
    alignSelf: 'center',
  },
  section: {
    marginBottom: spacing.lg,
    paddingTop: spacing.xs,
  },
  sectionHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    ...textStyles.sectionTitle,
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  pastSectionTitle: {
    ...textStyles.sectionTitle,
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 0,
    flex: 1,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  clearAllBtn: {
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
  },
  clearAllLabel: {
    ...textStyles.bodySmall,
    color: colors.danger,
    fontWeight: '600',
  },
  clearAllLabelDisabled: { opacity: 0.45 },
  wlCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 0,
    borderStartWidth: 3,
    borderStartColor: colors.accent + '99',
    ...shadows.card,
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  wlTop: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  wlDate: { ...textStyles.bodyMedium, flex: 1, textAlign: 'right' },
  wlSub: { ...textStyles.caption, fontSize: 13, marginTop: spacing.xs, textAlign: 'right', writingDirection: 'rtl' },
  wlPrefs: {
    ...textStyles.caption,
    fontSize: 12,
    color: colors.accent,
    marginTop: spacing.sm,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
