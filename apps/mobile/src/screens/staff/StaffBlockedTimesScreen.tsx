import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Platform,
  Modal,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { AppButton } from '../../components/ui/AppButton';
import { EmptyState } from '../../components/feedback/EmptyState';
import { Keyed } from '../../components/ui/Keyed';
import { useAuth } from '../../hooks/useAuth';
import { useStaffOperationalSurface } from '../../hooks/useStaffOperationalSurface';
import { useMyBlockedSlots } from '../../hooks/useMyBlockedSlots';
import { openDrawer } from '../../utils/nav';
import {
  getTodayDateString,
  parseYyyyMmDdToDate,
  toDateString,
  formatTimeHHMM,
  timeHHMMToReferenceDate,
  formatDateDmy,
} from '../../utils/dates';
import { isValidDateString, validateWorkingTimeRange } from '../../utils/validators';
import { colors, spacing, radius, shadows, presets, textStyles, iconSize } from '../../theme';
import { PageIntro } from '../../components/ui/PageIntro';
import { useAppLocale } from '../../contexts/LocaleContext';

function formatBlockedDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return formatDateDmy(d);
}

type PickerKind = 'date' | 'start' | 'end' | null;

const IOS_PICKER_TEXT = colors.text;
const IOS_PICKER_ACCENT = colors.accent;

export function StaffBlockedTimesScreen() {
  const { t } = useTranslation();
  const { pickerLocale } = useAppLocale();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const { token, canBlockOwnTime } = useAuth();
  const staffSurfaceOk = useStaffOperationalSurface() && canBlockOwnTime;
  const blocked = useMyBlockedSlots(token);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const [date, setDate] = useState(getTodayDateString());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [picker, setPicker] = useState<PickerKind>(null);
  /** See AdminBlockedTimesScreen — decoupled from startTime/endTime so the iOS spinner isn't
   * fed a controlled value mid-drag (that feedback loop is what causes off-by-one-minute picks). */
  const [draftTime, setDraftTime] = useState<Date>(() => timeHHMMToReferenceDate(''));

  const canAdd =
    date?.trim() &&
    startTime?.trim() &&
    endTime?.trim() &&
    isValidDateString(date.trim()) &&
    validateWorkingTimeRange(startTime.trim(), endTime.trim()).valid;

  const handleAdd = async () => {
    if (!canAdd) return;
    const dt = date.trim();
    const st = startTime.trim();
    const et = endTime.trim();
    const vr = validateWorkingTimeRange(st, et);
    if (!vr.valid) {
      Alert.alert(t('common.error'), vr.error);
      return;
    }
    const result = await blocked.add(dt, st, et);
    if (result.error) {
      Alert.alert(t('common.error'), result.error);
      return;
    }
    const n = result.cancelledAppointments ?? 0;
    if (n > 0) {
      Alert.alert(t('staff.blockOverlapTitle'), t('staff.blockOverlapBody', { count: n }));
    }
    setStartTime('');
    setEndTime('');
  };

  const handleRemove = async (id: string) => {
    const result = await blocked.remove(id);
    if (result.error) Alert.alert(t('common.error'), result.error);
  };

  const openTimePicker = (kind: 'start' | 'end') => {
    const current = kind === 'start' ? startTime : endTime;
    setDraftTime(timeHHMMToReferenceDate(current));
    setPicker(kind);
  };

  const commitTimePicker = () => {
    if (picker === 'start') setStartTime(formatTimeHHMM(draftTime));
    if (picker === 'end') setEndTime(formatTimeHHMM(draftTime));
    setPicker(null);
  };

  const onAndroidPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === 'dismissed') {
      if (Platform.OS === 'android') setPicker(null);
      return;
    }
    const kind = picker;
    if (Platform.OS === 'android') setPicker(null);
    if (!selected || !kind) return;
    // Android's picker is a native OS dialog — onChange fires once on confirm, not per drag tick,
    // so committing directly here is safe (no controlled-value feedback loop to worry about).
    if (kind === 'date') setDate(toDateString(selected));
    if (kind === 'start') setStartTime(formatTimeHHMM(selected));
    if (kind === 'end') setEndTime(formatTimeHHMM(selected));
  };

  useEffect(() => {
    if (!token || !staffSurfaceOk) {
      (navigation.navigate as (name: string) => void)('StaffDashboard');
    }
  }, [token, staffSurfaceOk, navigation]);

  if (!token || !staffSurfaceOk) {
    return null;
  }

  const dateValue = parseYyyyMmDdToDate(date);

  return (
    <Screen style={styles.container} noPadding>
      <BlackHeader
        title={t('staff.blockedTitle')}
        onBackPress={() => navigation.navigate('StaffDashboard')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          token ? (
            <RefreshControl refreshing={blocked.loading} onRefresh={blocked.onRefresh} />
          ) : undefined
        }
      >
        <View style={{ flexGrow: 1 }}>
        <PageIntro title={t('staff.blockedPageTitle')} />
        <View style={styles.addCard}>
          <Text style={styles.sectionTitle}>{t('staff.blockAddTitle')}</Text>
          <Text style={styles.hint}>{t('staff.blockHint')}</Text>

          <Text style={styles.label}>{t('staff.labelDate')}</Text>
          <TouchableOpacity
            style={styles.pickerField}
            onPress={() => setPicker('date')}
            activeOpacity={0.75}
          >
            <Ionicons name="calendar-outline" size={iconSize.md} color={colors.accent} />
            <Text style={styles.pickerFieldText}>{formatBlockedDate(date)}</Text>
            <Ionicons name="chevron-down" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <Text style={styles.label}>{t('staff.labelStartTime')}</Text>
          <TouchableOpacity
            style={styles.pickerField}
            onPress={() => openTimePicker('start')}
            activeOpacity={0.75}
          >
            <Ionicons name="time-outline" size={iconSize.md} color={colors.accent} />
            <Text style={[styles.pickerFieldText, !startTime && styles.pickerPlaceholder]}>
              {startTime || t('staff.pickTime')}
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <Text style={styles.label}>{t('staff.labelEndTime')}</Text>
          <TouchableOpacity
            style={styles.pickerField}
            onPress={() => openTimePicker('end')}
            activeOpacity={0.75}
          >
            <Ionicons name="time-outline" size={iconSize.md} color={colors.accent} />
            <Text style={[styles.pickerFieldText, !endTime && styles.pickerPlaceholder]}>
              {endTime || t('staff.pickTime')}
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <AppButton
            title={blocked.saving ? t('staff.blockSaving') : t('staff.blockBtn')}
            onPress={handleAdd}
            variant="primary"
            disabled={!canAdd || blocked.saving}
            loading={blocked.saving}
          />
        </View>

        <Text style={styles.listTitle}>{t('staff.blockListTitle')}</Text>
        {blocked.loading ? null : blocked.slots.length === 0 ? (
          <View style={styles.emptyListCard}>
            <View style={styles.emptyListInner}>
              <EmptyState message={t('staff.blockedEmpty')} icon="calendar-outline" />
            </View>
          </View>
        ) : (
          blocked.slots.map((slot) => (
            <Keyed key={slot.id}>
              <View style={styles.slotRow}>
                <View style={styles.slotInfo}>
                  <Text style={styles.slotDate}>{formatBlockedDate(slot.date)}</Text>
                  <Text style={styles.slotTime}>
                    {slot.time} – {slot.endTime}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.removeBtn, blocked.removingId === slot.id && styles.removeBtnDisabled]}
                  onPress={() => handleRemove(slot.id)}
                  disabled={!!blocked.removingId}
                  accessibilityRole="button"
                  accessibilityLabel={t('staff.blockRemoveA11y')}
                  accessibilityState={{ disabled: !!blocked.removingId, busy: blocked.removingId === slot.id }}
                >
                  {blocked.removingId === slot.id ? (
                    <Text style={styles.removeText}>...</Text>
                  ) : (
                    <Ionicons name="trash-outline" size={iconSize.lg} color={colors.danger} />
                  )}
                </TouchableOpacity>
              </View>
            </Keyed>
          ))
        )}
        </View>
      </ScrollView>

      {picker != null && Platform.OS === 'android' ? (
        <DateTimePicker
          value={picker === 'date' ? dateValue : draftTime}
          mode={picker === 'date' ? 'date' : 'time'}
          display={picker === 'date' ? 'default' : 'default'}
          is24Hour
          onChange={onAndroidPickerChange}
        />
      ) : null}

      {picker === 'date' && Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPicker(null)}>
          <Pressable style={styles.pickerBackdrop} onPress={() => setPicker(null)}>
            <Pressable
              style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={styles.pickerSheetTitle}>{t('staff.pickerSelectDate')}</Text>
              <View style={styles.pickerIosCalendarWrap}>
                <View style={styles.pickerIosCalendarInner}>
                  <DateTimePicker
                    value={dateValue}
                    mode="date"
                    display="inline"
                    locale={pickerLocale}
                    themeVariant="light"
                    textColor={IOS_PICKER_TEXT}
                    accentColor={IOS_PICKER_ACCENT}
                    style={{ width: windowWidth }}
                    onChange={(_, d) => d && setDate(toDateString(d))}
                  />
                </View>
              </View>
              <TouchableOpacity style={styles.pickerDone} onPress={() => setPicker(null)}>
                <Text style={styles.pickerDoneText}>{t('common.done')}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {picker === 'start' && Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPicker(null)}>
          <Pressable style={styles.pickerBackdrop} onPress={() => setPicker(null)}>
            <Pressable
              style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={styles.pickerSheetTitle}>{t('staff.timeStart')}</Text>
              <View style={styles.pickerIosSpinnerWrap}>
                <DateTimePicker
                  value={draftTime}
                  mode="time"
                  display="spinner"
                  is24Hour
                  locale={pickerLocale}
                  themeVariant="light"
                  textColor={IOS_PICKER_TEXT}
                  onChange={(_, d) => d && setDraftTime(d)}
                />
              </View>
              <TouchableOpacity style={styles.pickerDone} onPress={commitTimePicker}>
                <Text style={styles.pickerDoneText}>{t('common.done')}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {picker === 'end' && Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPicker(null)}>
          <Pressable style={styles.pickerBackdrop} onPress={() => setPicker(null)}>
            <Pressable
              style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={styles.pickerSheetTitle}>{t('staff.timeEnd')}</Text>
              <View style={styles.pickerIosSpinnerWrap}>
                <DateTimePicker
                  value={draftTime}
                  mode="time"
                  display="spinner"
                  is24Hour
                  locale={pickerLocale}
                  themeVariant="light"
                  textColor={IOS_PICKER_TEXT}
                  onChange={(_, d) => d && setDraftTime(d)}
                />
              </View>
              <TouchableOpacity style={styles.pickerDone} onPress={commitTimePicker}>
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
  scroll: { flex: 1 },
  content: { ...presets.scrollContent, paddingBottom: spacing.xxl },
  addCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl + 4,
    marginBottom: spacing.xl,
    ...shadows.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    ...textStyles.sectionTitle,
    marginBottom: spacing.sm,
  },
  hint: {
    ...textStyles.bodySmall,
    marginBottom: spacing.lg,
    textAlign: 'right',
  },
  label: {
    ...textStyles.bodySmall,
    fontSize: 15,
    marginBottom: spacing.xs,
    textAlign: 'right',
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
  },
  pickerPlaceholder: {
    color: colors.textMuted,
  },
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
    /** Calendar control is LTR; keeps grid centered in RTL Hebrew layout */
    direction: 'ltr',
  },
  pickerIosSpinnerWrap: {
    width: '100%',
    minHeight: 216,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyListCard: {
    marginBottom: spacing.lg,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  emptyListInner: {
    height: 220,
    justifyContent: 'center',
    alignItems: 'center',
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
  listTitle: {
    ...presets.sectionTitle,
    marginTop: spacing.md,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  slotInfo: { flex: 1 },
  slotDate: { ...textStyles.bodyMedium, textAlign: 'right' },
  slotTime: { ...textStyles.bodySmall, marginTop: spacing.xs, textAlign: 'right' },
  removeBtn: { padding: spacing.sm },
  removeBtnDisabled: { opacity: 0.5 },
  removeText: { fontSize: 14, color: colors.textMuted },
});
