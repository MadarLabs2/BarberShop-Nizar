import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Linking,
  LayoutAnimation,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { EmptyState } from '../../components/feedback/EmptyState';
import { Keyed } from '../../components/ui/Keyed';
import { LoadingState } from '../../components/feedback/LoadingState';
import { useAuth } from '../../hooks/useAuth';
import { getStaffSchedule, deleteAppointment } from '../../services/admin.api';
import type { StaffScheduleAppointment } from '../../services/admin.api';
import { fetchStaff } from '../../services/bookings.api';
import {
  getCachedSchedule,
  setCachedSchedule,
  prefetchAdminHeavyData,
} from '../../services/adminPrefetchCache';
import { getWarmStaffChipsForSchedule } from '../../hooks/useAdminCatalog';
import { openDrawer } from '../../utils/nav';
import { getDateRangeFromToday, formatIsoDateDmy, getWeekdayNameForYyyyMmDd, isAppointmentUpcoming } from '../../utils/dates';
import { colors, spacing, radius, shadows, presets, textStyles, iconSize } from '../../theme';
import { PageIntro } from '../../components/ui/PageIntro';
import { canAccessAdmin } from '../../lib/navigation.roles';
import { localizeCatalogString, useAppLocale } from '../../contexts/LocaleContext';

function ScheduleAppointmentCard({
  apt,
  onDelete,
  deleting,
}: {
  apt: StaffScheduleAppointment;
  onDelete: (apt: StaffScheduleAppointment) => void;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const digits = apt.clientPhone?.replace(/\D/g, '') || '';
  const telUrl =
    digits.length >= 9
      ? digits.startsWith('972')
        ? `tel:+${digits}`
        : `tel:${digits.startsWith('0') ? digits : '0' + digits}`
      : null;
  /** Start time already elapsed — visually distinguish from a still-upcoming appointment (this
   * is a 14-day range starting today, so only today's earlier slots are ever affected). Delete
   * stays available (record cleanup), this just stops it from reading as "still coming". */
  const isPast = !apt._isBlocked && !isAppointmentUpcoming(apt.date, apt.time);

  return (
    <View style={[styles.aptCard, apt._isBlocked && styles.aptCardBlocked, isPast && styles.aptCardDone]}>
      <View style={styles.aptMain}>
        <View style={styles.aptTopLine}>
          <Text style={[styles.aptTime, isPast && styles.aptTimeDone]}>{apt.time}</Text>
          <Text style={styles.aptService} numberOfLines={2}>
            {apt._isBlocked ? t('admin.blockedLabel') : localizeCatalogString(apt.serviceName, locale)}
          </Text>
          {isPast ? (
            <View style={styles.aptDoneBadge}>
              <Text style={styles.aptDoneBadgeText}>{t('admin.apptDone')}</Text>
            </View>
          ) : null}
        </View>
        {!apt._isBlocked && (
          <>
            <Text style={styles.aptClient} numberOfLines={1}>
              {apt.clientName}
            </Text>
            {apt.clientPhone && (
              <TouchableOpacity
                style={styles.phoneRow}
                onPress={() => telUrl && Linking.openURL(telUrl)}
                disabled={!telUrl}
              >
                <Ionicons name="call-outline" size={16} color={colors.accent} />
                <Text style={styles.aptPhone}>{apt.clientPhone}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        <Text style={styles.aptMeta} numberOfLines={2}>
          {[localizeCatalogString(apt.branchName, locale), apt.duration > 0 && t('admin.minutesShort', { n: apt.duration })]
            .filter(Boolean)
            .join(' • ') || (apt._isBlocked ? t('admin.minutesShort', { n: apt.duration }) : '')}
        </Text>
      </View>
      {!apt._isBlocked && (
        <TouchableOpacity
          style={styles.aptDeleteBtn}
          onPress={() => onDelete(apt)}
          disabled={deleting}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('admin.deleteAppointmentA11y')}
        >
          {deleting ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <Ionicons name="trash-outline" size={iconSize.md} color={colors.danger} />
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

export function AdminStaffScheduleScreen() {
  const { t } = useTranslation();
  const { localeTag } = useAppLocale();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const { token, role } = useAuth();
  const warmChips = getWarmStaffChipsForSchedule();
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>(() => warmChips ?? []);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(() => warmChips?.[0]?.id ?? '');
  const initialSid = warmChips?.[0]?.id ?? '';
  const [appointments, setAppointments] = useState<StaffScheduleAppointment[]>(() => {
    if (!initialSid) return [];
    const { from, to } = getDateRangeFromToday(14);
    return getCachedSchedule(initialSid, from, to) ?? [];
  });
  const [loading, setLoading] = useState(() => {
    if (!initialSid) return true;
    const { from, to } = getDateRangeFromToday(14);
    return getCachedSchedule(initialSid, from, to) === undefined;
  });
  const [refreshing, setRefreshing] = useState(false);
  /** Only one day expanded at a time — keeps long lists scannable */
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { from, to } = useMemo(() => getDateRangeFromToday(14), []);

  const scheduleReqId = useRef(0);

  const loadStaff = useCallback(async () => {
    try {
      const staff = await fetchStaff();
      setStaffList(staff.map((s) => ({ id: s.id, name: s.name })));
      setSelectedStaffId((prev) => (prev && staff.some((s) => s.id === prev) ? prev : staff[0]?.id || ''));
    } catch {
      setStaffList([]);
    }
  }, []);

  const loadSchedule = useCallback(
    async (opts?: { isPullRefresh?: boolean }) => {
      if (!token || !selectedStaffId) {
        setAppointments([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const reqId = ++scheduleReqId.current;
      const cached = getCachedSchedule(selectedStaffId, from, to);
      const hasCache = cached !== undefined;
      if (hasCache) {
        setAppointments(cached);
        setLoading(false);
        if (opts?.isPullRefresh) setRefreshing(true);
      } else {
        setLoading(true);
        setAppointments([]);
      }
      try {
        const list = await getStaffSchedule(token, selectedStaffId, from, to);
        if (reqId !== scheduleReqId.current) return;
        setCachedSchedule(selectedStaffId, from, to, list);
        setAppointments(list);
      } catch {
        if (reqId !== scheduleReqId.current) return;
        if (!hasCache) setAppointments([]);
      } finally {
        if (reqId !== scheduleReqId.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, selectedStaffId, from, to]
  );

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await loadStaff();
        if (token) void prefetchAdminHeavyData(token);
      })();
    }, [loadStaff, token]),
  );

  useEffect(() => {
    if (selectedStaffId) {
      void loadSchedule();
    } else {
      setAppointments([]);
    }
  }, [selectedStaffId, loadSchedule]);

  useEffect(() => {
    setExpandedDate(null);
  }, [selectedStaffId]);

  const toggleDay = useCallback((dateStr: string) => {
    // iOS keeps the native LayoutAnimation transition unchanged; Android uses the Reanimated
    // layout/entering/exiting props on the cards below instead (LayoutAnimation is unreliable
    // on Android under the New Architecture).
    if (Platform.OS === 'ios') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setExpandedDate((prev) => (prev === dateStr ? null : dateStr));
  }, []);

  const onRefresh = useCallback(() => {
    void loadSchedule({ isPullRefresh: true });
  }, [loadSchedule]);

  const handleDeleteAppointment = useCallback(
    (apt: StaffScheduleAppointment) => {
      Alert.alert(
        t('admin.deleteAppointmentTitle'),
        t('admin.deleteAppointmentMsg', { client: apt.clientName, service: apt.serviceName, time: apt.time }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('admin.deleteAppointmentYes'),
            style: 'destructive',
            onPress: async () => {
              if (!token) return;
              setDeletingId(apt.id);
              try {
                await deleteAppointment(token, apt.id);
                setAppointments((prev) => {
                  const next = prev.filter((a) => a.id !== apt.id);
                  setCachedSchedule(selectedStaffId, from, to, next);
                  return next;
                });
              } catch (e) {
                Alert.alert(t('common.error'), e instanceof Error ? e.message : t('admin.deleteAppointmentError'));
              } finally {
                setDeletingId(null);
              }
            },
          },
        ]
      );
    },
    [token, selectedStaffId, from, to, t]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, StaffScheduleAppointment[]>();
    for (const apt of appointments) {
      const list = map.get(apt.date) || [];
      list.push(apt);
      map.set(apt.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.time.localeCompare(b.time));
    }
    return map;
  }, [appointments]);

  const sortedDates = useMemo(() => Array.from(byDate.keys()).sort(), [byDate]);

  useEffect(() => {
    if (!token || !canAccessAdmin(role)) {
      (navigation.navigate as (name: string) => void)('Home');
    }
  }, [token, role, navigation]);

  if (!token || !canAccessAdmin(role)) {
    return null;
  }

  const selectedStaff = staffList.find((s) => s.id === selectedStaffId);

  return (
    <Screen style={styles.container} noPadding>
      <BlackHeader
        title={t('admin.scheduleHeader')}
        onBackPress={() => navigation.navigate('Dashboard')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ScreenEnter replayOnFocus remountKey={selectedStaffId ?? ''} variant="rise" style={{ flexGrow: 1 }}>
        <PageIntro title={t('admin.scheduleTitle')} />
        <View style={styles.staffChipsOuter}>
          <View style={styles.staffWrap}>
            {staffList.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.staffChip, selectedStaffId === s.id && styles.staffChipActive]}
                onPress={() => setSelectedStaffId(s.id)}
              >
                <Text style={[styles.staffChipText, selectedStaffId === s.id && styles.staffChipTextActive]}>
                  {s.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {selectedStaff && (
          <Text style={styles.subtitle}>{t('admin.scheduleSubtitle', { name: selectedStaff.name, from, to })}</Text>
        )}

        {!selectedStaffId ? (
          <EmptyState message={t('admin.schedulePickStaff')} icon="person-outline" />
        ) : loading && appointments.length === 0 ? (
          <View style={styles.loadingWrap}>
            <LoadingState />
          </View>
        ) : sortedDates.length === 0 ? (
          <EmptyState message={t('admin.scheduleNoApts')} icon="calendar-outline" />
        ) : (
          sortedDates.map((dateStr) => {
            const dayApts = byDate.get(dateStr) || [];
            const expanded = expandedDate === dateStr;
            const weekday = getWeekdayNameForYyyyMmDd(dateStr, localeTag);
            const dateDmy = formatIsoDateDmy(dateStr);
            const dayA11y = `${weekday}, ${dateDmy}`;
            return (
              <Keyed key={dateStr}>
                <Animated.View
                  style={styles.dayCard}
                  layout={Platform.OS === 'android' ? LinearTransition.duration(220) : undefined}
                >
                  <TouchableOpacity
                    style={styles.dayHeader}
                    onPress={() => toggleDay(dateStr)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={t('admin.scheduleDayA11y', { date: dayA11y })}
                  >
                    <View style={styles.dayHeaderTextCol}>
                      <Text style={styles.dayName} numberOfLines={2}>
                        {weekday}
                      </Text>
                      <Text style={styles.dayDate}>{dateDmy}</Text>
                    </View>
                    <View style={styles.dayHeaderActions}>
                      <View style={styles.dayCountPill}>
                        <Text style={styles.dayCountText}>{dayApts.length}</Text>
                      </View>
                      <Ionicons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={iconSize.md}
                        color={colors.textSecondary}
                      />
                    </View>
                  </TouchableOpacity>
                  {expanded ? (
                    <Animated.View
                      style={styles.dayAptsList}
                      entering={Platform.OS === 'android' ? FadeIn.duration(180) : undefined}
                      exiting={Platform.OS === 'android' ? FadeOut.duration(150) : undefined}
                    >
                      {dayApts.map((apt) => (
                        <Keyed key={apt.id}>
                          <ScheduleAppointmentCard
                            apt={apt}
                            onDelete={handleDeleteAppointment}
                            deleting={deletingId === apt.id}
                          />
                        </Keyed>
                      ))}
                    </Animated.View>
                  ) : null}
                </Animated.View>
              </Keyed>
            );
          })
        )}
        </ScreenEnter>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: presets.scrollContent,
  staffChipsOuter: { width: '100%', alignSelf: 'stretch' },
  staffWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  staffChip: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  staffChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  staffChipText: { ...textStyles.caption, color: colors.text, fontWeight: '600' },
  staffChipTextActive: { color: colors.surface, fontWeight: '700' },
  subtitle: {
    ...textStyles.bodySmall,
    marginBottom: spacing.lg,
    textAlign: 'right',
  },
  loadingWrap: { minHeight: 140, justifyContent: 'center' },
  dayCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  dayHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 52,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  dayHeaderTextCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  dayHeaderActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  dayCountPill: {
    minWidth: 28,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCountText: {
    ...textStyles.caption,
    fontWeight: '700',
    color: colors.textSecondary,
    fontVariant: Platform.OS === 'ios' ? ['tabular-nums'] : undefined,
  },
  dayName: { ...textStyles.bodyMedium, color: colors.text, textAlign: 'right' },
  dayDate: { ...textStyles.bodySmall, color: colors.textMuted, marginTop: 2, textAlign: 'right' },
  /** Same horizontal inset as `dayHeader` (dayCard padding + header xs) */
  dayAptsList: {
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    gap: 6,
  },
  aptCard: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
  },
  aptCardBlocked: { backgroundColor: colors.accent + '12' },
  aptCardDone: { opacity: 0.6 },
  aptMain: { flex: 1 },
  aptDeleteBtn: {
    padding: spacing.xs,
    borderRadius: radius.full,
  },
  aptTopLine: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  aptTime: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
    minWidth: 40,
    fontVariant: Platform.OS === 'ios' ? ['tabular-nums'] : undefined,
  },
  aptTimeDone: { color: colors.textTertiary },
  aptDoneBadge: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm - 2,
  },
  aptDoneBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  aptService: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'right',
    lineHeight: 18,
  },
  aptClient: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'right',
    fontWeight: '500',
  },
  phoneRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginTop: 3,
    alignSelf: 'flex-end',
    gap: 4,
  },
  aptPhone: { fontSize: 12, color: colors.accent, fontWeight: '600' },
  aptMeta: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: 'right',
  },
});
