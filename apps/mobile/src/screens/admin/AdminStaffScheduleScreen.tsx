import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Linking,
  LayoutAnimation,
  Platform,
  Alert,
  ActivityIndicator,
  DeviceEventEmitter,
} from 'react-native';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { EmptyState } from '../../components/feedback/EmptyState';
import { Keyed } from '../../components/ui/Keyed';
import { LoadingState } from '../../components/feedback/LoadingState';
import { AppButton } from '../../components/ui/AppButton';
import { useAuth } from '../../hooks/useAuth';
import {
  getStaffSchedule,
  deleteAppointment,
  getAllStaffWorkingDays,
  getBranchStaff,
  getStaffServices,
  getAdminCatalog,
  createAppointmentForStaff,
  type StaffScheduleAppointment,
  type StaffWorkingDaysMap,
  type Branch,
} from '../../services/admin.api';
import {
  ADMIN_APPOINTMENT_CREATED_EVENT,
  emitAdminAppointmentCreated,
  type AdminAppointmentCreatedPayload,
} from '../../lib/adminScheduleInvalidation';
import { fetchStaff, getAvailableSlots } from '../../services/bookings.api';
import {
  getCachedSchedule,
  setCachedSchedule,
  prefetchAdminHeavyData,
} from '../../services/adminPrefetchCache';
import { getWarmStaffChipsForSchedule } from '../../hooks/useAdminCatalog';
import { openDrawer } from '../../utils/nav';
import {
  getDateRangeFromToday,
  getNextDays,
  getTodayDateString,
  toDateString,
  formatIsoDateDmy,
  getWeekdayNameForYyyyMmDd,
  isAppointmentUpcoming,
  parseYyyyMmDdToDate,
} from '../../utils/dates';
import { colors, spacing, radius, shadows, presets, textStyles, iconSize } from '../../theme';
import { PageIntro } from '../../components/ui/PageIntro';
import { canAccessAdmin } from '../../lib/navigation.roles';
import { localizeCatalogString, pickLocalizedName, useAppLocale } from '../../contexts/LocaleContext';
import type { RootDrawerParamList } from '../../navigation/paramList';

function timeToMins(t: string): number {
  const [h, m] = String(t || '').slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

type ServiceOption = { id: string; name: string; nameHe: string; nameAr: string; price: number; duration: number };
type Segment =
  | { kind: 'occupied'; apt: StaffScheduleAppointment }
  | { kind: 'free'; startMins: number; endMins: number };

/** `null` = staff doesn't work this date at all. */
function computeSegmentsForDay(
  dateStr: string,
  staffId: string,
  workingDaysMap: StaffWorkingDaysMap,
  dayApts: StaffScheduleAppointment[]
): Segment[] | null {
  const dayOfWeek = parseYyyyMmDdToDate(dateStr).getDay();
  const dayEntry = (workingDaysMap[staffId] || []).find((d) => d.dayOfWeek === dayOfWeek);
  if (!dayEntry) return null;
  const windowStart = timeToMins(dayEntry.startTime);
  const windowEnd = timeToMins(dayEntry.endTime);
  const active = [...dayApts]
    .map((a) => ({ apt: a, start: timeToMins(a.time), end: timeToMins(a.time) + (a.duration || 40) }))
    .sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let cursor = windowStart;
  for (const item of active) {
    if (item.start > cursor) out.push({ kind: 'free', startMins: cursor, endMins: item.start });
    out.push({ kind: 'occupied', apt: item.apt });
    cursor = Math.max(cursor, item.end);
  }
  if (cursor < windowEnd) out.push({ kind: 'free', startMins: cursor, endMins: windowEnd });
  return out;
}

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
          <View style={styles.rowSubLine}>
            <Text style={styles.aptClient} numberOfLines={1}>
              {apt.clientName}
            </Text>
            {apt.clientPhone ? (
              <TouchableOpacity
                style={styles.phoneRow}
                onPress={() => telUrl && Linking.openURL(telUrl)}
                disabled={!telUrl}
              >
                <Ionicons name="call-outline" size={14} color={colors.accent} />
                <Text style={styles.aptPhone}>{apt.clientPhone}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>
      {!apt._isBlocked && !isPast && (
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
            <Ionicons name="trash-outline" size={iconSize.sm} color={colors.danger} />
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

function FreeRow({ startMins, endMins, onPress }: { startMins: number; endMins: number; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity style={styles.freeRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.freeRowIcon}>
        <Ionicons name="add" size={15} color={colors.accent} />
      </View>
      <Text style={styles.freeRowText}>
        {minsToTime(startMins)}–{minsToTime(endMins)} · {t('admin.timelineFreeLabel')}
      </Text>
    </TouchableOpacity>
  );
}

export function AdminStaffScheduleScreen() {
  const { t } = useTranslation();
  const { locale, localeTag } = useAppLocale();
  const navigation = useNavigation<{ navigate: (name: string, params?: Record<string, unknown>) => void; openDrawer?: () => void }>();
  const route = useRoute<{
    key: string;
    name: string;
    params?: { staffId?: string; date?: string; returnTo?: keyof RootDrawerParamList; mode?: 'add' };
  }>();
  const { token, role } = useAuth();
  /** "Add appointment" (dashboard row) opens the full walk-in booking flow — free-slot timeline +
   * inline add-panel. Plain "לוח זמנים" (Schedule card) is browse-only: it must keep showing just
   * the day's existing appointments, unchanged from how it always has, with today front and center. */
  const isAddMode = route.params?.mode === 'add';
  const warmChips = getWarmStaffChipsForSchedule();
  /** `staffId` present-but-undefined (from the dashboard's "Add appointment" row when there's more
   * than one staff member) is a deliberate "let the admin choose" signal — distinct from the key
   * being absent entirely (e.g. from the "Schedule" browsing card), where falling back to a
   * convenience default is fine. `in` distinguishes the two; plain optional chaining can't. */
  const forceEmptyStaffSelection = useRef(!!route.params && 'staffId' in route.params && !route.params.staffId).current;
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>(() => warmChips ?? []);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(() => {
    if (forceEmptyStaffSelection) return '';
    return route.params?.staffId ?? warmChips?.[0]?.id ?? '';
  });
  const initialSid = forceEmptyStaffSelection ? '' : route.params?.staffId ?? warmChips?.[0]?.id ?? '';
  const [appointments, setAppointments] = useState<StaffScheduleAppointment[]>(() => {
    if (!initialSid) return [];
    const { from, to } = getDateRangeFromToday(14);
    return getCachedSchedule(initialSid, from, to) ?? [];
  });
  const [workingDaysMap, setWorkingDaysMap] = useState<StaffWorkingDaysMap>({});
  const [staffBranches, setStaffBranches] = useState<Branch[]>([]);
  const [staffServiceOptions, setStaffServiceOptions] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(() => {
    if (!initialSid) return true;
    const { from, to } = getDateRangeFromToday(14);
    return getCachedSchedule(initialSid, from, to) === undefined;
  });
  const [refreshing, setRefreshing] = useState(false);
  /** Only one day expanded at a time — keeps a 2-week list scannable. In browse mode (לוח זמנים),
   * today opens by default so the admin immediately sees the current day's appointments. */
  const [expandedDate, setExpandedDate] = useState<string | null>(
    route.params?.date ?? (isAddMode ? null : getTodayDateString())
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** Which day's add-panel is open (null = closed). Only one at a time, always inside its own expanded day. */
  const [panelDate, setPanelDate] = useState<string | null>(null);
  const [preferredTime, setPreferredTime] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const panelRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);

  const { from, to } = useMemo(() => getDateRangeFromToday(14), []);
  const allDates = useMemo(() => getNextDays(14).map(toDateString), []);
  /** Browse mode (לוח זמנים) only ever shows today — the 2-week spread stays exclusive to the
   * "Add appointment" walk-in flow, which needs it to book ahead. */
  const displayDates = isAddMode ? allDates : allDates.slice(0, 1);

  const scheduleReqId = useRef(0);

  const loadStaff = useCallback(async () => {
    try {
      const staff = await fetchStaff();
      setStaffList(staff.map((s) => ({ id: s.id, name: s.name })));
      setSelectedStaffId((prev) => {
        if (prev && staff.some((s) => s.id === prev)) return prev;
        // Respect the "let the admin choose" signal even after the real staff list lands —
        // otherwise the picker would silently auto-fill the moment this resolves.
        if (forceEmptyStaffSelection) return '';
        return staff[0]?.id || '';
      });
    } catch {
      setStaffList([]);
    }
  }, [forceEmptyStaffSelection]);

  const loadSchedule = useCallback(
    async (opts?: { isPullRefresh?: boolean }) => {
      if (!token || !selectedStaffId) {
        setAppointments([]);
        setWorkingDaysMap({});
        setStaffBranches([]);
        setStaffServiceOptions([]);
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
        const [list, workingDaysRes, branchLinks, serviceLinks, catalog] = await Promise.all([
          getStaffSchedule(token, selectedStaffId, from, to),
          getAllStaffWorkingDays(token),
          getBranchStaff(token),
          getStaffServices(token),
          getAdminCatalog(token),
        ]);
        if (reqId !== scheduleReqId.current) return;
        setCachedSchedule(selectedStaffId, from, to, list);
        setAppointments(list);
        setWorkingDaysMap(workingDaysRes);

        const branchIds = new Set(branchLinks.filter((l) => l.staffId === selectedStaffId).map((l) => l.branchId));
        setStaffBranches(catalog.branches.filter((b) => b.isActive && branchIds.has(b.id)));

        const serviceById = new Map(catalog.services.filter((s) => s.isActive).map((s) => [s.id, s]));
        const svcOpts: ServiceOption[] = serviceLinks
          .filter((l) => l.staffId === selectedStaffId && serviceById.has(l.serviceId))
          .map((l) => {
            const svc = serviceById.get(l.serviceId)!;
            return { id: svc.id, name: svc.name, nameHe: svc.nameHe, nameAr: svc.nameAr, price: l.price, duration: l.duration };
          });
        setStaffServiceOptions(svcOpts);
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

  /** Admin books a walk-in — refetch immediately for the staff it happened to, instead of waiting for a staff switch. */
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      ADMIN_APPOINTMENT_CREATED_EVENT,
      (payload: AdminAppointmentCreatedPayload) => {
        if (payload.staffId === selectedStaffId) void loadSchedule();
      }
    );
    return () => sub.remove();
  }, [selectedStaffId, loadSchedule]);

  useEffect(() => {
    setExpandedDate(isAddMode ? null : getTodayDateString());
    setPanelDate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStaffId]);

  useEffect(() => {
    if (staffBranches.length === 1 && !selectedBranchId) {
      setSelectedBranchId(staffBranches[0].id);
    }
  }, [staffBranches, selectedBranchId]);

  useEffect(() => {
    if (!token || !panelDate || !selectedServiceId || !selectedBranchId) {
      setSlots(null);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    setSlots(null);
    setSelectedTime(null);
    void getAvailableSlots({ staffId: selectedStaffId, date: panelDate, serviceId: selectedServiceId, branchId: selectedBranchId })
      .then((res) => {
        if (cancelled) return;
        setSlots(res.slots);
        if (preferredTime && res.slots.includes(preferredTime)) setSelectedTime(preferredTime);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedStaffId, panelDate, selectedServiceId, selectedBranchId]);

  const expandDay = useCallback((dateStr: string) => {
    if (Platform.OS === 'ios') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setExpandedDate(dateStr);
  }, []);

  const toggleDay = useCallback(
    (dateStr: string) => {
      if (Platform.OS === 'ios') {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      setExpandedDate((prev) => (prev === dateStr ? null : dateStr));
      if (expandedDate !== dateStr) setPanelDate(null);
    },
    [expandedDate]
  );

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

  const openPanel = useCallback(
    (dateStr: string, hintStart?: number) => {
      setPanelDate(dateStr);
      setPreferredTime(hintStart != null ? minsToTime(hintStart) : null);
      setSelectedServiceId(null);
      setSelectedTime(null);
      setClientName('');
      setClientPhone('');
      setSelectedBranchId(staffBranches.length === 1 ? staffBranches[0].id : null);
      expandDay(dateStr);
      setTimeout(() => {
        try {
          panelRef.current?.measureInWindow((_x, y) => {
            scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
          });
        } catch {
          /* best-effort scroll-into-view only */
        }
      }, 120);
    },
    [staffBranches, expandDay]
  );

  const closePanel = useCallback(() => {
    setPanelDate(null);
    setSelectedServiceId(null);
    setSelectedTime(null);
    setSlots(null);
  }, []);

  const canSubmit =
    !!panelDate && !!selectedServiceId && !!selectedBranchId && !!selectedTime && clientName.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!token || !canSubmit || !panelDate || !selectedServiceId || !selectedBranchId || !selectedTime) return;
    setSubmitting(true);
    try {
      await createAppointmentForStaff(token, {
        staffId: selectedStaffId,
        branchId: selectedBranchId,
        serviceId: selectedServiceId,
        date: panelDate,
        time: selectedTime,
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim() || undefined,
      });
      const bookedDate = panelDate;
      const bookedName = clientName.trim();
      const bookedTime = selectedTime;
      closePanel();
      await loadSchedule();
      emitAdminAppointmentCreated({ staffId: selectedStaffId, date: bookedDate });
      Alert.alert(t('admin.formSuccessTitle'), t('admin.formSuccessMsg', { name: bookedName, time: bookedTime }));
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : t('admin.formSubmitError'));
    } finally {
      setSubmitting(false);
    }
  }, [token, canSubmit, panelDate, selectedServiceId, selectedBranchId, selectedTime, selectedStaffId, clientName, clientPhone, closePanel, loadSchedule, t]);

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

  const segmentsByDate = useMemo(() => {
    const map = new Map<string, Segment[] | null>();
    for (const dateStr of allDates) {
      map.set(dateStr, computeSegmentsForDay(dateStr, selectedStaffId, workingDaysMap, byDate.get(dateStr) || []));
    }
    return map;
  }, [allDates, selectedStaffId, workingDaysMap, byDate]);

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
        onBackPress={() => navigation.navigate(route.params?.returnTo ?? 'Dashboard')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ScreenEnter replayOnFocus remountKey={selectedStaffId ?? ''} variant="rise" style={{ flexGrow: 1 }}>
        <PageIntro title={t('admin.scheduleTitle')} compact />
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
          <Text style={styles.subtitle}>
            {isAddMode
              ? t('admin.scheduleSubtitle', { name: selectedStaff.name, from: formatIsoDateDmy(from), to: formatIsoDateDmy(to) })
              : t('admin.scheduleSubtitleToday', { name: selectedStaff.name, date: formatIsoDateDmy(displayDates[0]) })}
          </Text>
        )}

        {!selectedStaffId ? (
          <EmptyState message={t('admin.schedulePickStaff')} icon="person-outline" />
        ) : loading && appointments.length === 0 ? (
          <View style={styles.loadingWrap}>
            <LoadingState />
          </View>
        ) : (
          displayDates.map((dateStr) => {
            const dayApts = byDate.get(dateStr) || [];
            const expanded = expandedDate === dateStr;
            const weekday = getWeekdayNameForYyyyMmDd(dateStr, localeTag);
            const dateDmy = formatIsoDateDmy(dateStr);
            const dayA11y = `${weekday}, ${dateDmy}`;
            const segments = segmentsByDate.get(dateStr);
            const isWorkDay = segments !== null;
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
                      <Text style={[styles.dayName, !isWorkDay && styles.dayTextMuted]} numberOfLines={2}>
                        {weekday}
                      </Text>
                      <Text style={[styles.dayDate, !isWorkDay && styles.dayTextMuted]}>{dateDmy}</Text>
                    </View>
                    <View style={styles.dayHeaderActions}>
                      {isAddMode && isWorkDay ? (
                        <TouchableOpacity
                          style={styles.dayAddBtn}
                          onPress={() => openPanel(dateStr)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={t('admin.timelineAddCta')}
                        >
                          <Ionicons name="add-circle-outline" size={iconSize.lg} color={colors.accent} />
                        </TouchableOpacity>
                      ) : null}
                      {dayApts.length > 0 ? (
                        <View style={styles.dayCountPill}>
                          <Text style={styles.dayCountText}>{dayApts.length}</Text>
                        </View>
                      ) : null}
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
                      {!isAddMode || !isWorkDay ? (
                        dayApts.length > 0 ? (
                          dayApts.map((apt) => (
                            <Keyed key={apt.id}>
                              <ScheduleAppointmentCard apt={apt} onDelete={handleDeleteAppointment} deleting={deletingId === apt.id} />
                            </Keyed>
                          ))
                        ) : (
                          <Text style={styles.notWorkDayText}>
                            {t(isAddMode || !isWorkDay ? 'admin.timelineNotWorkDay' : 'admin.dayNoAppointments')}
                          </Text>
                        )
                      ) : (
                        (segments ?? []).map((seg, idx) => (
                          <Keyed key={seg.kind === 'occupied' ? seg.apt.id : `free-${dateStr}-${seg.startMins}-${idx}`}>
                            {seg.kind === 'occupied' ? (
                              <ScheduleAppointmentCard apt={seg.apt} onDelete={handleDeleteAppointment} deleting={deletingId === seg.apt.id} />
                            ) : (
                              <FreeRow startMins={seg.startMins} endMins={seg.endMins} onPress={() => openPanel(dateStr, seg.startMins)} />
                            )}
                          </Keyed>
                        ))
                      )}

                      {isAddMode && panelDate === dateStr ? (
                        <Animated.View
                          ref={panelRef}
                          style={styles.panel}
                          entering={Platform.OS === 'android' ? FadeIn.duration(180) : undefined}
                          exiting={Platform.OS === 'android' ? FadeOut.duration(150) : undefined}
                          layout={Platform.OS === 'android' ? LinearTransition.duration(200) : undefined}
                        >
                          <View style={styles.panelHeader}>
                            <Text style={styles.panelTitle}>{t('admin.timelineAddCta')}</Text>
                            <TouchableOpacity onPress={closePanel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                              <Ionicons name="close" size={22} color={colors.textTertiary} />
                            </TouchableOpacity>
                          </View>

                          <Text style={styles.panelLabel}>{t('admin.formServiceLabel')}</Text>
                          <View style={styles.chipWrap}>
                            {staffServiceOptions.map((svc) => (
                              <TouchableOpacity
                                key={svc.id}
                                style={[styles.chip, selectedServiceId === svc.id && styles.chipActive]}
                                onPress={() => setSelectedServiceId(svc.id)}
                              >
                                <Text style={[styles.chipText, selectedServiceId === svc.id && styles.chipTextActive]}>
                                  {pickLocalizedName(svc, locale)} · ₪{svc.price}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>

                          {staffBranches.length > 1 ? (
                            <>
                              <Text style={styles.panelLabel}>{t('admin.formBranchLabel')}</Text>
                              <View style={styles.chipWrap}>
                                {staffBranches.map((br) => (
                                  <TouchableOpacity
                                    key={br.id}
                                    style={[styles.chip, selectedBranchId === br.id && styles.chipActive]}
                                    onPress={() => setSelectedBranchId(br.id)}
                                  >
                                    <Text style={[styles.chipText, selectedBranchId === br.id && styles.chipTextActive]}>
                                      {pickLocalizedName(br, locale)}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </>
                          ) : null}

                          {selectedServiceId && selectedBranchId ? (
                            <>
                              <Text style={styles.panelLabel}>{t('admin.formTimeLabel')}</Text>
                              {slotsLoading ? (
                                <ActivityIndicator color={colors.accent} style={styles.slotsSpinner} />
                              ) : slots && slots.length > 0 ? (
                                <View style={styles.chipWrap}>
                                  {slots.map((s) => (
                                    <TouchableOpacity
                                      key={s}
                                      style={[styles.timeChip, selectedTime === s && styles.chipActive]}
                                      onPress={() => setSelectedTime(s)}
                                    >
                                      <Text style={[styles.chipText, selectedTime === s && styles.chipTextActive]}>{s}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              ) : (
                                <Text style={styles.noSlotsText}>{t('admin.formNoSlots')}</Text>
                              )}
                            </>
                          ) : null}

                          <Text style={styles.panelLabel}>{t('admin.formClientNameLabel')}</Text>
                          <TextInput
                            style={styles.input}
                            value={clientName}
                            onChangeText={setClientName}
                            placeholder={t('admin.formClientNamePh')}
                            placeholderTextColor={colors.textMuted}
                            textAlign="right"
                          />

                          <Text style={styles.panelLabel}>{t('admin.formClientPhoneLabel')}</Text>
                          <TextInput
                            style={styles.input}
                            value={clientPhone}
                            onChangeText={setClientPhone}
                            placeholder={t('admin.formClientPhonePh')}
                            placeholderTextColor={colors.textMuted}
                            textAlign="right"
                            keyboardType="phone-pad"
                          />
                          <Text style={styles.phoneHint}>{t('admin.formClientPhoneHint')}</Text>

                          <AppButton
                            title={submitting ? t('admin.formSubmitBusy') : t('admin.formSubmit')}
                            onPress={handleSubmit}
                            variant="primary"
                            disabled={!canSubmit}
                            loading={submitting}
                            style={styles.submitBtn}
                          />
                        </Animated.View>
                      ) : null}
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
  content: { ...presets.scrollContent, paddingBottom: spacing.xxl },
  staffChipsOuter: { width: '100%', alignSelf: 'stretch' },
  staffWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
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
    marginBottom: spacing.md,
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
  dayAddBtn: {
    padding: 2,
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
  dayTextMuted: { color: colors.textTertiary },
  /** Same horizontal inset as `dayHeader` (dayCard padding + header xs) */
  dayAptsList: {
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    gap: 6,
  },
  notWorkDayText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'right',
    paddingVertical: spacing.sm,
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
  rowSubLine: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  aptClient: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
    textAlign: 'right',
    fontWeight: '500',
  },
  phoneRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  aptPhone: { fontSize: 12, color: colors.accent, fontWeight: '600' },
  freeRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm - 2,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  freeRowIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent + '18',
    justifyContent: 'center',
    alignItems: 'center',
  },
  freeRowText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  panel: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  panelHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  panelTitle: { ...textStyles.sectionTitle, fontSize: 15 },
  panelLabel: {
    ...textStyles.bodySmall,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: spacing.sm + 2,
    marginBottom: spacing.xs + 2,
    textAlign: 'right',
  },
  chipWrap: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.xs + 2 },
  chip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timeChip: {
    minWidth: 58,
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.text },
  chipTextActive: { color: colors.onPrimary },
  slotsSpinner: { marginVertical: spacing.sm },
  noSlotsText: { fontSize: 12, color: colors.textMuted, textAlign: 'right' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  phoneHint: {
    fontSize: 10,
    color: colors.textTertiary,
    textAlign: 'right',
    marginTop: 4,
  },
  submitBtn: { marginTop: spacing.md },
});
