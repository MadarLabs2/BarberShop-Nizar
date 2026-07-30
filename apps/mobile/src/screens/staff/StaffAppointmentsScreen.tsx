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
  Pressable,
  Platform,
  Alert,
  LayoutAnimation,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { PageIntro } from '../../components/ui/PageIntro';
import { EmptyState } from '../../components/feedback/EmptyState';
import { Keyed } from '../../components/ui/Keyed';
import { LoadingState } from '../../components/feedback/LoadingState';
import { useAuth } from '../../hooks/useAuth';
import { getMyStaffAppointments } from '../../services/admin.api';
import type { MyStaffAppointment } from '../../services/admin.api';
import { cancelAppointment } from '../../services/bookings.api';
import {
  peekStaffAppointments,
  setStaffAppointmentsCache,
  invalidateStaffAppointmentsCache,
} from '../../services/staffPrefetchCache';
import { openDrawer } from '../../utils/nav';
import {
  getCurrentWeekDates,
  formatDayShort,
  getTodayDateString,
  getWeekdayNameForYyyyMmDd,
} from '../../utils/dates';
import { colors, spacing, radius, shadows, presets, textStyles, iconSize } from '../../theme';
import { useStaffOperationalSurface } from '../../hooks/useStaffOperationalSurface';
import { localizeCatalogString, useAppLocale } from '../../contexts/LocaleContext';

function getTelUrl(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '') || '';
  if (digits.length < 9) return null;
  return digits.startsWith('972')
    ? `tel:+${digits}`
    : `tel:${digits.startsWith('0') ? digits : '0' + digits}`;
}

/** Premium expandable block — tap shows full list (time, service, client name) without duplicating the week list. */
function ClosestDayHero({
  dateStr,
  appointments: apts,
  localeTag,
  expanded,
  onToggleExpanded,
  expandedAptId,
  onToggleApt,
  onCancelPress,
  cancelDisabled,
}: {
  dateStr: string;
  appointments: MyStaffAppointment[];
  localeTag: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  expandedAptId: string | null;
  onToggleApt: (id: string) => void;
  onCancelPress: (apt: MyStaffAppointment) => void;
  cancelDisabled: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Animated.View
      style={styles.closestHeroOuter}
      layout={Platform.OS === 'android' ? LinearTransition.duration(220) : undefined}
    >
      <View style={styles.closestHeroTop}>
        <Pressable
          onPress={onToggleExpanded}
          style={({ pressed }) => [styles.closestHeroHeader, pressed && styles.closestHeroHeaderPressed]}
          android_ripple={{ color: colors.accent + '22' }}
        >
          <View style={styles.closestHeroIconRing}>
            <Ionicons name="calendar-outline" size={22} color={colors.accent} />
          </View>
          <View style={styles.closestHeroTitles}>
            <Text style={styles.closestHeroKicker}>{t('staff.apptClosestHeroKicker')}</Text>
            <Text style={styles.closestHeroDate} numberOfLines={1}>
              {getWeekdayNameForYyyyMmDd(dateStr, localeTag)} · {formatDayShort(dateStr, localeTag)}
            </Text>
            <Text style={styles.closestHeroHint}>
              {expanded ? t('staff.apptClosestTapCollapse') : t('staff.apptClosestTapExpand')}
            </Text>
          </View>
          <View style={styles.closestHeroEnd}>
            <View style={styles.closestHeroBadge}>
              <Text style={styles.closestHeroBadgeTxt}>{apts.length}</Text>
            </View>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={expanded ? colors.accent : colors.textSecondary}
            />
          </View>
        </Pressable>
      </View>

      {expanded ? (
        <Animated.View
          style={styles.closestHeroList}
          entering={Platform.OS === 'android' ? FadeIn.duration(180) : undefined}
          exiting={Platform.OS === 'android' ? FadeOut.duration(150) : undefined}
        >
          <Text style={styles.closestHeroListHeading}>{t('staff.apptClosestListHeading')}</Text>
          <View style={styles.closestHeroListBody}>
            {apts.map((apt) => (
              <Keyed key={apt.id}>
                <WeekAppointmentRow
                  apt={apt}
                  isExpanded={expandedAptId === apt.id}
                  onPress={() => onToggleApt(apt.id)}
                  onCancelPress={() => onCancelPress(apt)}
                  cancelDisabled={cancelDisabled}
                  compact
                />
              </Keyed>
            ))}
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** Single appointment row inside an expanded day */
function WeekAppointmentRow({
  apt,
  isExpanded,
  onPress,
  onCancelPress,
  cancelDisabled,
  compact,
}: {
  apt: MyStaffAppointment;
  isExpanded: boolean;
  onPress: () => void;
  onCancelPress: () => void;
  cancelDisabled: boolean;
  /** Slightly denser row when nested under the closest-day hero */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const telUrl = getTelUrl(apt.clientPhone);
  return (
    <TouchableOpacity
      style={[
        styles.weekAptRow,
        compact && styles.weekAptRowCompact,
        isExpanded && styles.weekAptRowOpen,
      ]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.weekAptMain}>
        <Text style={[styles.weekAptTime, compact && styles.weekAptTimeCompact]}>{apt.time}</Text>
        <View style={styles.weekAptMid}>
          <Text
            style={[styles.weekAptService, compact && styles.weekAptServiceCompact]}
            numberOfLines={isExpanded ? undefined : 1}
          >
            {localizeCatalogString(apt.serviceName, locale)}
          </Text>
          <Text style={[styles.weekAptClient, compact && styles.weekAptClientCompact]} numberOfLines={1}>
            {apt.clientName}
          </Text>
        </View>
        <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={compact ? 16 : 17} color={colors.textTertiary} />
      </View>
      {isExpanded ? (
        <View style={styles.weekAptExpand}>
          {apt.clientPhone ? (
            <TouchableOpacity
              style={styles.phoneRow}
              onPress={() => telUrl && Linking.openURL(telUrl)}
              disabled={!telUrl}
            >
              <Ionicons name="call-outline" size={iconSize.sm} color={colors.accent} />
              <Text style={styles.aptPhone}>{apt.clientPhone}</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.aptMeta}>
            {[localizeCatalogString(apt.branchName, locale), apt.duration > 0 && t('staff.minutesShort', { n: apt.duration })].filter(Boolean).join(' · ')}
          </Text>
          <TouchableOpacity
            style={[styles.cancelAptBtn, cancelDisabled && styles.cancelAptBtnDisabled]}
            onPress={onCancelPress}
            disabled={cancelDisabled}
            activeOpacity={0.75}
          >
            <Ionicons name="close-circle-outline" size={iconSize.sm} color={cancelDisabled ? colors.textMuted : colors.danger} />
            <Text style={[styles.cancelAptBtnText, cancelDisabled && styles.cancelAptBtnTextDisabled]}>
              {t('staff.cancelAppointment')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export function StaffAppointmentsScreen() {
  const { t } = useTranslation();
  const { localeTag } = useAppLocale();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const { token, user } = useAuth();
  const staffSurfaceOk = useStaffOperationalSurface();
  const initialPeek = peekStaffAppointments();
  /** Non-empty peek = trust cache for skip logic; `[]` still refetches on focus (admin+staff after link). */
  const peekTrustedLoaded = initialPeek != null && initialPeek.length > 0;
  const [appointments, setAppointments] = useState<MyStaffAppointment[]>(() => initialPeek ?? []);
  const [loading, setLoading] = useState(() => initialPeek == null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedDayStr, setExpandedDayStr] = useState<string | null>(null);
  const [expandedDayAptId, setExpandedDayAptId] = useState<string | null>(null);
  const [closestBlockOpen, setClosestBlockOpen] = useState(false);
  const [expandedClosestAptId, setExpandedClosestAptId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const lastLoadAtRef = useRef(peekTrustedLoaded ? Date.now() : 0);
  const hasLoadedRef = useRef(peekTrustedLoaded);
  const staffIdPrevRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!closestBlockOpen) setExpandedClosestAptId(null);
  }, [closestBlockOpen]);

  const toggleClosestBlock = useCallback(() => {
    // iOS keeps the native LayoutAnimation transition unchanged; Android uses the Reanimated
    // layout/entering/exiting props on the cards below instead (LayoutAnimation is unreliable
    // on Android under the New Architecture).
    if (Platform.OS === 'ios') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setClosestBlockOpen((prev) => {
      if (!prev) {
        setExpandedDayStr(null);
        setExpandedDayAptId(null);
      }
      return !prev;
    });
  }, []);

  const toggleClosestApt = useCallback((id: string) => {
    setExpandedClosestAptId((p) => (p === id ? null : id));
  }, []);

  const toggleDay = useCallback((dateStr: string) => {
    if (Platform.OS === 'ios') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setExpandedDayStr((p) => (p === dateStr ? null : dateStr));
    setExpandedDayAptId(null);
    setClosestBlockOpen(false);
  }, []);
  const toggleDayApt = useCallback((id: string) => {
    setExpandedDayAptId((p) => (p === id ? null : id));
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const list = await getMyStaffAppointments(token);
      setStaffAppointmentsCache(list);
      setAppointments(list);
    } catch {
      setAppointments((prev) => (prev.length > 0 ? prev : []));
    } finally {
      setLoading(false);
      setRefreshing(false);
      lastLoadAtRef.current = Date.now();
      hasLoadedRef.current = true;
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      hasLoadedRef.current = false;
      lastLoadAtRef.current = 0;
      setAppointments([]);
      setLoading(true);
    }
  }, [token]);

  const staffId = user?.staffId ?? null;
  useEffect(() => {
    if (staffIdPrevRef.current === undefined) {
      staffIdPrevRef.current = staffId;
      return;
    }
    if (staffIdPrevRef.current === staffId) return;
    staffIdPrevRef.current = staffId;
    invalidateStaffAppointmentsCache();
    hasLoadedRef.current = false;
    lastLoadAtRef.current = 0;
    setAppointments([]);
    if (token) {
      setLoading(true);
      void load();
    }
  }, [staffId, token, load]);

  useFocusEffect(
    useCallback(() => {
      const peekNow = peekStaffAppointments();
      if (peekNow !== null) {
        setAppointments(peekNow);
        setLoading(false);
      }
      const staleMs = 45_000;
      const shouldRefetch = !hasLoadedRef.current || Date.now() - lastLoadAtRef.current > staleMs;
      if (!shouldRefetch) return;
      if (!hasLoadedRef.current) setLoading(true);
      load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const requestCancelAppointment = useCallback(
    (apt: MyStaffAppointment) => {
      if (!token || cancelingId) return;
      Alert.alert(t('staff.cancelAppointmentConfirmTitle'), t('staff.cancelAppointmentConfirmBody', { name: apt.clientName, time: apt.time }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('staff.cancelAppointment'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setCancelingId(apt.id);
              try {
                await cancelAppointment(apt.id, token);
                setAppointments((prev) => {
                  const next = prev.filter((a) => a.id !== apt.id);
                  setStaffAppointmentsCache(next);
                  return next;
                });
                setExpandedDayAptId((id) => (id === apt.id ? null : id));
                setExpandedClosestAptId((id) => (id === apt.id ? null : id));
                Alert.alert(t('staff.cancelAppointmentOkTitle'), t('staff.cancelAppointmentOkBody'));
              } catch (e) {
                Alert.alert(t('common.error'), e instanceof Error ? e.message : t('staff.cancelAppointmentFailed'));
              } finally {
                setCancelingId(null);
              }
            })();
          },
        },
      ]);
    },
    [token, cancelingId, t],
  );

  const weekDays = useMemo(() => getCurrentWeekDates(localeTag), [localeTag]);

  const byDate = useMemo(() => {
    const map = new Map<string, MyStaffAppointment[]>();
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

  const closestDayStr = useMemo(() => {
    const today = getTodayDateString();
    const dates = [...byDate.keys()].sort();
    for (const d of dates) {
      if (d >= today && (byDate.get(d)?.length ?? 0) > 0) return d;
    }
    return null;
  }, [byDate]);

  const closestDayApts = closestDayStr ? byDate.get(closestDayStr) ?? [] : [];

  useEffect(() => {
    setClosestBlockOpen(false);
  }, [closestDayStr]);

  useEffect(() => {
    if (!token || !staffSurfaceOk) {
      (navigation.navigate as (name: string) => void)('Home');
    }
  }, [token, staffSurfaceOk, navigation]);

  if (!token || !staffSurfaceOk) {
    return null;
  }

  const todayStr = getTodayDateString();

  return (
    <Screen style={styles.container} noPadding>
      <BlackHeader
        title={t('staff.myAppointmentsTitle')}
        onBackPress={() => navigation.navigate('StaffDashboard')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
        <PageIntro compact title={t('staff.calendarTitle')} />
        {loading && appointments.length === 0 ? (
          <View style={styles.loadingWrap}>
            <LoadingState />
          </View>
        ) : null}

        {!(loading && appointments.length === 0) ? (
          <>
            {appointments.length === 0 ? (
              <View style={styles.emptyHintWrap}>
                <EmptyState message={t('staff.noUpcoming')} icon="calendar-outline" />
              </View>
            ) : closestDayStr && closestDayApts.length > 0 ? (
              <ClosestDayHero
                dateStr={closestDayStr}
                appointments={closestDayApts}
                localeTag={localeTag}
                expanded={closestBlockOpen}
                onToggleExpanded={toggleClosestBlock}
                expandedAptId={expandedClosestAptId}
                onToggleApt={toggleClosestApt}
                onCancelPress={requestCancelAppointment}
                cancelDisabled={!!cancelingId}
              />
            ) : (
              <Text style={styles.closestEmpty}>{t('staff.apptClosestEmpty')}</Text>
            )}

            <View style={styles.weekBoard}>
              <View style={styles.weekBoardHeader}>
                <View style={styles.weekBoardAccent} />
                <View style={styles.weekBoardHeaderText}>
                  <Text style={styles.weekBoardTitle}>{t('staff.apptWeekTitle')}</Text>
                  <Text style={styles.weekBoardHint}>{t('staff.apptWeekHint')}</Text>
                </View>
              </View>

              {weekDays.map((day, index) => {
                const dayApts = byDate.get(day.dateStr) || [];
                const isDayExpanded = expandedDayStr === day.dateStr;
                const isToday = day.dateStr === todayStr;
                const isPastDay = day.dateStr < todayStr;
                const isClosest = closestDayStr != null && day.dateStr === closestDayStr;
                const isLast = index === weekDays.length - 1;

                return (
                  <Animated.View
                    key={day.dateStr}
                    layout={Platform.OS === 'android' ? LinearTransition.duration(220) : undefined}
                    style={[
                      styles.weekRowShell,
                      !isLast && styles.weekRowShellBorder,
                      isPastDay && styles.weekRowShellDone,
                      isClosest && dayApts.length > 0 && styles.weekRowShellHighlight,
                      isDayExpanded && styles.weekRowShellOpen,
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.dayHeader}
                      onPress={() => toggleDay(day.dateStr)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.dayHeaderText}>
                        <View style={styles.dayMainLine}>
                          <Text style={[styles.dayName, isToday && styles.dayNameToday]}>
                            {day.weekdayName}
                          </Text>
                          <Text style={styles.dayDate}>
                            {formatDayShort(day.dateStr, localeTag)}
                          </Text>
                        </View>
                        <View style={styles.dayMetaLine}>
                          {isPastDay ? <Text style={styles.dayDoneInline}>{t('staff.apptDayDone')}</Text> : null}
                          {isToday ? (
                            <View style={styles.todayPill}>
                              <Text style={styles.todayPillText}>{t('appointments.today')}</Text>
                            </View>
                          ) : null}
                          {isClosest && dayApts.length > 0 ? (
                            <View style={styles.soonPill}>
                              <Text style={styles.soonPillText}>{t('staff.apptSoonBadge')}</Text>
                            </View>
                          ) : null}
                          {dayApts.length > 0 ? (
                            <View style={styles.dayBadge}>
                              <Text style={styles.dayBadgeText}>{dayApts.length}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      <Ionicons
                        name={isDayExpanded ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color={isDayExpanded ? colors.accent : colors.textTertiary}
                      />
                    </TouchableOpacity>
                    {isDayExpanded ? (
                      <Animated.View
                        style={styles.dayBody}
                        entering={Platform.OS === 'android' ? FadeIn.duration(180) : undefined}
                        exiting={Platform.OS === 'android' ? FadeOut.duration(150) : undefined}
                      >
                        {dayApts.length === 0 ? (
                          <Text style={styles.dayEmpty}>{t('staff.apptDayEmpty')}</Text>
                        ) : (
                          dayApts.map((apt) => (
                            <Keyed key={apt.id}>
                              <WeekAppointmentRow
                                apt={apt}
                                isExpanded={expandedDayAptId === apt.id}
                                onPress={() => toggleDayApt(apt.id)}
                                onCancelPress={() => requestCancelAppointment(apt)}
                                cancelDisabled={!!cancelingId}
                              />
                            </Keyed>
                          ))
                        )}
                      </Animated.View>
                    ) : null}
                  </Animated.View>
                );
              })}
            </View>
          </>
        ) : null}
        </ScreenEnter>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scroll: { flex: 1, backgroundColor: '#ffffff' },
  content: {
    ...presets.scrollContent,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
    backgroundColor: '#ffffff',
  },
  loadingWrap: { minHeight: 120, justifyContent: 'center' },

  emptyHintWrap: {
    marginBottom: spacing.md,
    alignSelf: 'stretch',
  },

  closestEmpty: {
    ...textStyles.bodySmall,
    color: colors.textMuted,
    textAlign: 'right',
    marginBottom: spacing.md,
    writingDirection: 'rtl',
  },

  closestHeroOuter: {
    marginBottom: spacing.lg,
    borderRadius: radius.xl + 2,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    borderStartWidth: 4,
    borderStartColor: colors.accent,
    ...shadows.card,
    shadowOpacity: 0.06,
    elevation: 2,
  },
  closestHeroTop: {
    backgroundColor: '#ffffff',
  },
  closestHeroHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: spacing.md + 4,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  closestHeroHeaderPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  closestHeroIconRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent + '66',
    backgroundColor: colors.accent + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closestHeroTitles: {
    flex: 1,
    minWidth: 0,
  },
  closestHeroKicker: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.accent,
    textAlign: 'right',
    marginBottom: 4,
    letterSpacing: 0.4,
    writingDirection: 'rtl',
  },
  closestHeroDate: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 4,
  },
  closestHeroHint: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: 'right',
    lineHeight: 16,
    writingDirection: 'rtl',
  },
  closestHeroEnd: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
  },
  closestHeroBadge: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closestHeroBadgeTxt: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.onPrimary,
  },
  closestHeroList: {
    backgroundColor: '#ffffff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  closestHeroListHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.accent,
    textAlign: 'right',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    letterSpacing: 0.2,
    writingDirection: 'rtl',
  },
  closestHeroListBody: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },

  weekBoard: {
    borderRadius: radius.xl + 2,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
    ...shadows.cardStrong,
    shadowOpacity: 0.06,
    elevation: 4,
  },
  weekBoardHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  weekBoardAccent: {
    width: 4,
    alignSelf: 'stretch',
    minHeight: 36,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  weekBoardHeaderText: { flex: 1 },
  weekBoardTitle: {
    ...textStyles.sectionTitle,
    fontSize: 16,
    marginBottom: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  weekBoardHint: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },

  weekRowShell: {
    backgroundColor: '#ffffff',
  },
  weekRowShellBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  weekRowShellHighlight: {
    backgroundColor: colors.accent + '0c',
  },
  weekRowShellDone: {
    backgroundColor: '#ffffff',
  },
  weekRowShellOpen: {
    backgroundColor: '#ffffff',
  },

  dayHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.md,
    minHeight: 60,
  },
  dayHeaderText: {
    alignItems: 'flex-end',
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  dayMainLine: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dayMetaLine: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 16,
  },
  dayName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  dayNameToday: {
    color: colors.primary,
  },
  dayDate: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  dayDoneInline: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    writingDirection: 'rtl',
    marginBottom: 1,
  },
  todayPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  todayPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.onPrimary,
    writingDirection: 'rtl',
  },
  soonPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.accent + '33',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent + '55',
  },
  soonPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.accent,
    writingDirection: 'rtl',
  },
  dayBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.onPrimary,
  },
  dayBody: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
    backgroundColor: '#fafafa',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    gap: spacing.xs,
  },
  dayEmpty: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'right',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    writingDirection: 'rtl',
  },

  weekAptRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    borderStartWidth: 3,
    borderStartColor: colors.accent,
  },
  weekAptRowOpen: {
    borderColor: colors.accent + '44',
  },
  weekAptRowCompact: {
    paddingVertical: spacing.sm - 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.md,
  },
  weekAptTimeCompact: {
    fontSize: 13,
    minWidth: 48,
  },
  weekAptServiceCompact: {
    fontSize: 13,
  },
  weekAptClientCompact: {
    fontSize: 11,
  },
  weekAptMain: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
  },
  weekAptTime: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.accent,
    minWidth: 52,
    textAlign: 'right',
    ...(Platform.OS === 'ios' ? { fontVariant: ['tabular-nums' as const] } : null),
  },
  weekAptMid: { flex: 1, minWidth: 0 },
  weekAptService: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  weekAptClient: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  weekAptExpand: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    gap: 4,
  },

  phoneRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 6,
  },
  aptPhone: { fontSize: 14, color: colors.accent, fontWeight: '600' },
  aptMeta: { fontSize: 12, color: colors.textMuted, textAlign: 'right', writingDirection: 'rtl' },
  cancelAptBtn: {
    marginTop: spacing.sm,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  cancelAptBtnDisabled: { opacity: 0.5 },
  cancelAptBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.danger,
    textAlign: 'right',
  },
  cancelAptBtnTextDisabled: { color: colors.textMuted },
});
