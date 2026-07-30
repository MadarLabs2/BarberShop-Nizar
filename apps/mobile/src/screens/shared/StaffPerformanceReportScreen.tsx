import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  Pressable,
  Platform,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  getStaffReportFromCache,
  setStaffReportCache,
  staffReportCacheKey,
} from '../../services/staffReportCache';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { AppButton } from '../../components/ui/AppButton';
import { useAuth } from '../../hooks/useAuth';
import { openDrawer } from '../../utils/nav';
import { canAccessAdmin } from '../../lib/navigation.roles';
import { apiFetchBinary } from '../../services/api';
import {
  adminStaffReportPdfPath,
  getAdminStaffPerformanceReport,
  getMyStaffPerformanceReport,
  myStaffReportPdfPath,
  type StaffPerformanceReport,
} from '../../services/admin.api';
import { colors, spacing, radius, textStyles, iconSize, layout, shadows } from '../../theme';
import { LAYOUT_EASE_OUT_SMOOTH } from '../../theme/motion';
import { useAppLocale } from '../../contexts/LocaleContext';
import { formatDateDmy, getTodayDateString, parseYyyyMmDdToDate, toDateString } from '../../utils/dates';
import { isValidDateString } from '../../utils/validators';

function firstOfMonthYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const PDF_CTA_ENTER_MS = 400;
const PDF_CTA_ENTER = FadeInDown.duration(PDF_CTA_ENTER_MS)
  .easing(LAYOUT_EASE_OUT_SMOOTH)
  .withInitialValues({ transform: [{ translateY: 10 }] });

function statusLabel(status: string, tr: (k: string) => string): string {
  if (status === 'confirmed') return tr('staff.reportStatusConfirmed');
  if (status === 'completed') return tr('staff.reportStatusCompleted');
  return status;
}

type DatePickTarget = 'from' | 'to' | null;

const IOS_PICKER_TEXT = colors.text;
const IOS_PICKER_ACCENT = colors.accent;

export function StaffPerformanceReportScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void; openDrawer?: () => void }>();
  const route = useRoute();
  const { token, role, hasStaffProfile } = useAuth();
  const { pickerLocale } = useAppLocale();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const isAdminReport = route.name === 'AdminStaffReport';
  const adminParams =
    (route.params as { staffId?: string; staffName?: string; returnTo?: 'hub' | 'adminStaff' } | undefined) ?? {};
  const staffId = isAdminReport ? adminParams.staffId : undefined;
  const staffNameHint = isAdminReport ? adminParams.staffName : undefined;
  const returnTo = isAdminReport ? (adminParams.returnTo ?? 'adminStaff') : undefined;

  const [fromYmd, setFromYmd] = useState('');
  const [toYmd, setToYmd] = useState('');
  const [appliedFrom, setAppliedFrom] = useState<string | undefined>(undefined);
  const [appliedTo, setAppliedTo] = useState<string | undefined>(undefined);
  const [report, setReport] = useState<StaffPerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [apptsExpanded, setApptsExpanded] = useState(false);
  const [datePicker, setDatePicker] = useState<DatePickTarget>(null);
  const fetchGenerationRef = useRef(0);
  const prevAdminStaffIdRef = useRef<string>('');
  const prevReportKeyRef = useRef<string>('');

  const reportCacheKey = useMemo(
    () => staffReportCacheKey(isAdminReport, staffId, appliedFrom, appliedTo),
    [isAdminReport, staffId, appliedFrom, appliedTo],
  );

  /** Hydrate from prefetch cache; avoid blank spinner when possible; SWR on range change. */
  useLayoutEffect(() => {
    if (!token) return;
    if (isAdminReport && !staffId?.trim()) return;
    if (!isAdminReport && !hasStaffProfile) return;

    const cached = getStaffReportFromCache(reportCacheKey);
    if (cached) {
      setReport(cached);
      setLoading(false);
    } else {
      const prevKey = prevReportKeyRef.current;
      const prevSid = isAdminReport ? prevAdminStaffIdRef.current : '';
      const curSid = (staffId ?? '').trim();
      const adminStaffChanged = isAdminReport && prevSid !== '' && curSid !== '' && prevSid !== curSid;
      if (adminStaffChanged) {
        setReport(null);
        setLoading(true);
        setApptsExpanded(false);
      } else if (prevKey !== '' && prevKey !== reportCacheKey) {
        setLoading(true);
      }
    }
    prevReportKeyRef.current = reportCacheKey;
    if (isAdminReport && staffId?.trim()) prevAdminStaffIdRef.current = staffId.trim();
  }, [token, isAdminReport, staffId, hasStaffProfile, reportCacheKey]);

  useEffect(() => {
    if (!token) {
      navigation.navigate('Login');
      return;
    }
    if (isAdminReport) {
      if (!canAccessAdmin(role)) {
        navigation.navigate(hasStaffProfile ? 'StaffDashboard' : 'Home');
        return;
      }
      if (!staffId?.trim()) {
        navigation.navigate('Admin', { tab: 'staff' });
      }
    } else if (!hasStaffProfile) {
      navigation.navigate('Home');
    }
  }, [token, role, hasStaffProfile, navigation, isAdminReport, staffId]);

  const fetchReport = useCallback(
    async (from?: string, to?: string, opts?: { silent?: boolean }) => {
      if (!token) return;
      if (isAdminReport && !staffId?.trim()) return;
      const gen = ++fetchGenerationRef.current;
      const cacheKey = staffReportCacheKey(isAdminReport, staffId, from, to);
      try {
        const data = isAdminReport
          ? await getAdminStaffPerformanceReport(token, staffId!.trim(), from, to)
          : await getMyStaffPerformanceReport(token, from, to);
        if (gen !== fetchGenerationRef.current) return;
        setReport(data);
        setStaffReportCache(cacheKey, data);
      } catch (e) {
        if (gen !== fetchGenerationRef.current) return;
        setReport(null);
        Alert.alert(t('common.error'), e instanceof Error ? e.message : t('staff.reportLoadFailed'));
      } finally {
        if (gen === fetchGenerationRef.current && !opts?.silent) setLoading(false);
      }
    },
    [token, isAdminReport, staffId, t],
  );

  useEffect(() => {
    if (!token) return;
    if (isAdminReport && !staffId?.trim()) return;
    if (!isAdminReport && !hasStaffProfile) return;
    void fetchReport(appliedFrom, appliedTo);
  }, [token, staffId, isAdminReport, hasStaffProfile, appliedFrom, appliedTo, fetchReport]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchReport(appliedFrom, appliedTo, { silent: true }).finally(() => setRefreshing(false));
  }, [fetchReport, appliedFrom, appliedTo]);

  const applyRange = useCallback(() => {
    const f = fromYmd.trim();
    const tt = toYmd.trim();
    setAppliedFrom(f && isValidDateString(f) ? f : undefined);
    setAppliedTo(tt && isValidDateString(tt) ? tt : undefined);
  }, [fromYmd, toYmd]);

  const headerTitle = isAdminReport ? t('admin.staffReportScreenTitle') : t('staff.reportScreenTitle');

  const onBack = useCallback(() => {
    if (isAdminReport) {
      if (returnTo === 'hub') {
        navigation.navigate('AdminStaffReportHub');
      } else {
        navigation.navigate('Admin', { tab: 'staff' });
      }
    } else {
      navigation.navigate('StaffDashboard');
    }
  }, [isAdminReport, navigation, returnTo]);

  const onDownloadPdf = useCallback(async () => {
    if (!token) return;
    if (isAdminReport && !staffId?.trim()) return;
    setPdfBusy(true);
    try {
      const pdfLang: 'he' | 'ar' = i18n.language.startsWith('ar') ? 'ar' : 'he';
      const path = isAdminReport
        ? adminStaffReportPdfPath(staffId!.trim(), appliedFrom, appliedTo, pdfLang)
        : myStaffReportPdfPath(appliedFrom, appliedTo, pdfLang);
      const buf = await apiFetchBinary(path, { token, method: 'GET' });
      const file = new File(Paths.cache, `staff-report-${Date.now()}.pdf`);
      file.write(new Uint8Array(buf));
      const uri = file.uri;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: t('staff.reportShareTitle'),
        });
      } else {
        Alert.alert(t('staff.reportShareUnavailableTitle'), t('staff.reportShareUnavailableMsg'));
      }
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : t('staff.reportPdfFailed'));
    } finally {
      setPdfBusy(false);
    }
  }, [token, isAdminReport, staffId, appliedFrom, appliedTo, i18n.language, t]);

  const listAppointments = useMemo(() => report?.appointments ?? [], [report]);

  /** Prefer route name so the title updates the instant admin picks another staff, before the network returns. */
  const displayName = staffNameHint?.trim() || report?.staffName || '';

  const fromDateValue = useMemo(() => {
    if (fromYmd && isValidDateString(fromYmd)) return parseYyyyMmDdToDate(fromYmd);
    return parseYyyyMmDdToDate(firstOfMonthYmd());
  }, [fromYmd]);

  const toDateValue = useMemo(() => {
    if (toYmd && isValidDateString(toYmd)) return parseYyyyMmDdToDate(toYmd);
    return parseYyyyMmDdToDate(getTodayDateString());
  }, [toYmd]);

  const formatYmdLabel = (ymd: string) => {
    if (!ymd.trim() || !isValidDateString(ymd.trim())) return t('staff.reportDatePlaceholder');
    return formatDateDmy(parseYyyyMmDdToDate(ymd.trim()));
  };

  const onAndroidDateChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === 'dismissed') {
      if (Platform.OS === 'android') setDatePicker(null);
      return;
    }
    const which = datePicker;
    if (Platform.OS === 'android') setDatePicker(null);
    if (!selected || !which) return;
    const y = toDateString(selected);
    if (which === 'from') setFromYmd(y);
    if (which === 'to') setToYmd(y);
  };

  const pdfCtaRemountKey = isAdminReport ? `staff-${staffId?.trim() ?? ''}` : 'self';

  if (!token || (isAdminReport && (!staffId?.trim() || !canAccessAdmin(role)))) {
    return null;
  }
  if (!isAdminReport && !hasStaffProfile) {
    return null;
  }

  return (
    <Screen style={styles.container} noPadding>
      <BlackHeader
        title={headerTitle}
        onBackPress={onBack}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <View style={styles.pdfBar}>
        <Animated.View key={pdfCtaRemountKey} entering={PDF_CTA_ENTER}>
          <Pressable
            onPress={() => void onDownloadPdf()}
            disabled={pdfBusy}
            accessibilityRole="button"
            accessibilityLabel={t('staff.reportDownloadPdf')}
            style={({ pressed }) => [
              styles.pdfPill,
              pressed && !pdfBusy ? styles.pdfPillPressed : null,
              pdfBusy ? styles.pdfPillDisabled : null,
            ]}
          >
            {pdfBusy ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <>
                <Text style={styles.pdfPillText}>{t('staff.reportDownloadPdf')}</Text>
                <Ionicons name="arrow-down-circle-outline" size={iconSize.sm} color={colors.accent} />
              </>
            )}
          </Pressable>
        </Animated.View>
      </View>
      <ScrollView
        key={`${staffId ?? 'me'}-${appliedFrom ?? ''}-${appliedTo ?? ''}`}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        {displayName ? (
          <Text style={styles.staffNameKicker} numberOfLines={2}>
            {displayName}
          </Text>
        ) : null}

        <Text style={styles.rangeLabel}>{t('staff.reportLabelFrom')}</Text>
        <TouchableOpacity style={styles.pickerField} onPress={() => setDatePicker('from')} activeOpacity={0.75}>
          <Ionicons name="calendar-outline" size={iconSize.md} color={colors.accent} />
          <Text style={[styles.pickerFieldText, !fromYmd && styles.pickerPlaceholder]}>{formatYmdLabel(fromYmd)}</Text>
          <Ionicons name="chevron-down" size={18} color={colors.textTertiary} />
        </TouchableOpacity>

        <Text style={styles.rangeLabel}>{t('staff.reportLabelTo')}</Text>
        <TouchableOpacity style={styles.pickerField} onPress={() => setDatePicker('to')} activeOpacity={0.75}>
          <Ionicons name="calendar-outline" size={iconSize.md} color={colors.accent} />
          <Text style={[styles.pickerFieldText, !toYmd && styles.pickerPlaceholder]}>{formatYmdLabel(toYmd)}</Text>
          <Ionicons name="chevron-down" size={18} color={colors.textTertiary} />
        </TouchableOpacity>

        <AppButton title={t('staff.reportApplyRange')} onPress={applyRange} variant="secondary" style={styles.applyBtn} />

        {loading && report ? (
          <View style={styles.refreshingRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.refreshingHint}>{t('staff.reportRefreshing')}</Text>
          </View>
        ) : null}

        {loading && !report ? (
          <View style={styles.skeletonBlock}>
            <ActivityIndicator size="small" color={colors.accent} style={styles.skeletonSpinner} />
            <View style={styles.skeletonCard} />
            <View style={styles.skeletonCard} />
            <View style={styles.skeletonCardShort} />
          </View>
        ) : report ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('staff.reportPeriod')}</Text>
              <Text style={styles.cardLine}>
                {report.from} — {report.to}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('staff.reportSummary')}</Text>
              <Text style={styles.cardLine}>{t('staff.reportTotalRows', { count: report.counts.total })}</Text>
              <Text style={styles.cardLine}>
                {t('staff.reportCountsLineTwo', {
                  confirmed: report.counts.confirmed,
                  completed: report.counts.completed,
                })}
              </Text>
              <Text style={styles.cardLineEm}>{t('staff.reportRevenue', { amount: report.revenueAgendaShekels })}</Text>
              <Text style={styles.revenueNote}>{t('staff.reportRevenueNote')}</Text>
            </View>

            <View style={styles.card}>
              <TouchableOpacity
                style={styles.apptHeader}
                onPress={() => setApptsExpanded((x) => !x)}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={apptsExpanded ? 'chevron-up' : 'chevron-down'}
                  size={iconSize.md}
                  color={colors.accent}
                  style={styles.apptChevron}
                />
                <View style={styles.apptHeaderTextWrap}>
                  <Text style={styles.apptHeaderTitle}>{t('staff.reportAppointments')}</Text>
                  <Text style={styles.apptHeaderCount}>
                    {apptsExpanded
                      ? t('staff.reportAppointmentsExpandedHint')
                      : t('staff.reportAppointmentsCollapsed', { count: listAppointments.length })}
                  </Text>
                </View>
              </TouchableOpacity>
              {apptsExpanded
                ? listAppointments.map((a) => (
                    <View key={a.id} style={styles.aptRow}>
                      <View style={styles.aptTop}>
                        <Text style={styles.aptMeta}>
                          {a.date} {a.time}
                        </Text>
                        <Text style={styles.aptPrice}>{a.price != null ? `₪${a.price}` : '—'}</Text>
                      </View>
                      <Text style={styles.aptLine} numberOfLines={2}>
                        {a.clientName}
                      </Text>
                      <Text style={styles.aptSub} numberOfLines={1}>
                        {statusLabel(a.status, t)}
                      </Text>
                    </View>
                  ))
                : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      {datePicker != null && Platform.OS === 'android' ? (
        <DateTimePicker
          value={datePicker === 'from' ? fromDateValue : toDateValue}
          mode="date"
          display="default"
          onChange={onAndroidDateChange}
        />
      ) : null}

      {datePicker === 'from' && Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setDatePicker(null)}>
          <Pressable style={styles.pickerBackdrop} onPress={() => setDatePicker(null)}>
            <Pressable
              style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={styles.pickerSheetTitle}>{t('staff.reportLabelFrom')}</Text>
              <View style={styles.pickerIosCalendarWrap}>
                <View style={styles.pickerIosCalendarInner}>
                  <DateTimePicker
                    value={fromDateValue}
                    mode="date"
                    display="inline"
                    locale={pickerLocale}
                    themeVariant="light"
                    textColor={IOS_PICKER_TEXT}
                    accentColor={IOS_PICKER_ACCENT}
                    style={{ width: windowWidth }}
                    onChange={(_, d) => d && setFromYmd(toDateString(d))}
                  />
                </View>
              </View>
              <TouchableOpacity style={styles.pickerDone} onPress={() => setDatePicker(null)} activeOpacity={0.88}>
                <Text style={styles.pickerDoneText}>{t('common.done')}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {datePicker === 'to' && Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setDatePicker(null)}>
          <Pressable style={styles.pickerBackdrop} onPress={() => setDatePicker(null)}>
            <Pressable
              style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={styles.pickerSheetTitle}>{t('staff.reportLabelTo')}</Text>
              <View style={styles.pickerIosCalendarWrap}>
                <View style={styles.pickerIosCalendarInner}>
                  <DateTimePicker
                    value={toDateValue}
                    mode="date"
                    display="inline"
                    locale={pickerLocale}
                    themeVariant="light"
                    textColor={IOS_PICKER_TEXT}
                    accentColor={IOS_PICKER_ACCENT}
                    style={{ width: windowWidth }}
                    onChange={(_, d) => d && setToYmd(toDateString(d))}
                  />
                </View>
              </View>
              <TouchableOpacity style={styles.pickerDone} onPress={() => setDatePicker(null)} activeOpacity={0.88}>
                <Text style={styles.pickerDoneText}>{t('common.done')}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  pdfBar: {
    width: '100%',
    flexDirection: 'row',
    direction: 'rtl',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  pdfPill: {
    flexDirection: 'row',
    direction: 'rtl',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  pdfPillPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  pdfPillDisabled: { opacity: 0.55 },
  pdfPillText: {
    ...textStyles.bodySmall,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl + spacing.lg,
  },
  staffNameKicker: {
    ...textStyles.bodyMedium,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.md,
  },
  rangeLabel: {
    ...textStyles.bodySmall,
    fontSize: 15,
    marginBottom: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pickerField: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    minHeight: 52,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  pickerFieldText: {
    flex: 1,
    fontSize: 17,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pickerPlaceholder: { color: colors.textMuted },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    alignItems: 'stretch',
  },
  pickerSheet: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    maxHeight: '92%',
    alignSelf: 'stretch',
  },
  pickerSheetTitle: {
    ...textStyles.sectionTitle,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    color: colors.text,
  },
  pickerIosCalendarWrap: {
    width: '100%',
    minHeight: 340,
    backgroundColor: '#ffffff',
    alignItems: 'center',
  },
  pickerIosCalendarInner: {
    width: '100%',
    alignItems: 'center',
    direction: 'ltr',
  },
  pickerDone: {
    alignSelf: 'stretch',
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  pickerDoneText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  applyBtn: { marginBottom: spacing.lg },
  centered: { paddingVertical: spacing.xxl, alignItems: 'center' },
  skeletonBlock: { marginTop: spacing.sm, marginBottom: spacing.lg },
  skeletonSpinner: { alignSelf: 'center', marginBottom: spacing.md },
  skeletonCard: {
    height: 88,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  skeletonCardShort: {
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  refreshingRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  refreshingHint: {
    ...textStyles.caption,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderStartWidth: 3,
    borderStartColor: colors.accent,
    ...shadows.card,
  },
  cardTitle: {
    ...textStyles.bodyMedium,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.sm,
  },
  cardLine: {
    ...textStyles.body,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.xs,
  },
  cardLineEm: {
    ...textStyles.body,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: spacing.xs,
  },
  revenueNote: {
    ...textStyles.caption,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: spacing.sm,
  },
  apptHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  apptChevron: { marginEnd: spacing.xs },
  apptHeaderTextWrap: { flex: 1, alignItems: 'flex-end' },
  apptHeaderTitle: {
    ...textStyles.bodyMedium,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  apptHeaderCount: {
    ...textStyles.bodySmall,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 2,
  },
  aptRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  aptTop: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aptLine: {
    ...textStyles.body,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: spacing.xs,
  },
  aptSub: {
    ...textStyles.caption,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 2,
  },
  aptMeta: {
    ...textStyles.bodySmall,
    color: colors.textSecondary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  aptPrice: {
    ...textStyles.bodySmall,
    fontWeight: '600',
    color: colors.accent,
    marginStart: spacing.sm,
  },
});
