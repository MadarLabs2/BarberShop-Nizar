import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Keyed } from '../../components/ui/Keyed';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { AppButton } from '../../components/ui/AppButton';
import { useAuth } from '../../hooks/useAuth';
import { useStaffOperationalSurface } from '../../hooks/useStaffOperationalSurface';
import { useMyWorkingHours } from '../../hooks/useMyWorkingHours';
import { openDrawer } from '../../utils/nav';
import { colors, spacing, radius, presets, shadows, textStyles } from '../../theme';
import { PageIntro } from '../../components/ui/PageIntro';
import { WheelTimePickerSheet } from '../../components/ui/WheelTimePickerSheet';

export function StaffWorkingHoursScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const { token, canSetOwnWorkingHours } = useAuth();
  const staffSurfaceOk = useStaffOperationalSurface() && canSetOwnWorkingHours;
  const workingHours = useMyWorkingHours(token);
  const [timePicker, setTimePicker] = useState<{ dayOfWeek: number; field: 'start' | 'end' } | null>(null);

  useEffect(() => {
    if (!token || !staffSurfaceOk) {
      (navigation.navigate as (name: string) => void)('StaffDashboard');
    }
  }, [token, staffSurfaceOk, navigation]);

  if (!token || !staffSurfaceOk) {
    return null;
  }

  return (
    <Screen style={styles.wrapper} noPadding>
      <BlackHeader
        title={t('staff.workingHoursTitle')}
        onBackPress={() => navigation.navigate('StaffDashboard')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          token ? (
            <RefreshControl refreshing={workingHours.loading} onRefresh={workingHours.onRefresh} />
          ) : undefined
        }
      >
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
        <PageIntro title={t('staff.hoursTitle')} />
        <View style={styles.card}>
          <Text style={styles.hint}>{t('staff.workingHint')}</Text>
          {workingHours.loading ? (
            <Text style={styles.loading}>{t('staff.workingLoading')}</Text>
          ) : (
            <>
              {workingHours.days.map((d) => (
                <Keyed key={d.dayOfWeek}>
                <View style={styles.workDayRow}>
                  <TouchableOpacity
                    style={[styles.workDayToggle, d.enabled && styles.workDayToggleActive]}
                    onPress={() => workingHours.toggleDay(d.dayOfWeek)}
                  >
                    <Text style={[styles.workDayToggleText, d.enabled && styles.workDayToggleTextActive]}>
                      {workingHours.DAY_NAMES[d.dayOfWeek]}
                    </Text>
                  </TouchableOpacity>
                  {d.enabled && (
                    <View style={styles.workDayTimes}>
                      <TouchableOpacity
                        style={styles.timeInput}
                        onPress={() => setTimePicker({ dayOfWeek: d.dayOfWeek, field: 'start' })}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.timeInputText}>{d.startTime}</Text>
                      </TouchableOpacity>
                      <Text style={styles.timeSeparator}>–</Text>
                      <TouchableOpacity
                        style={styles.timeInput}
                        onPress={() => setTimePicker({ dayOfWeek: d.dayOfWeek, field: 'end' })}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.timeInputText}>{d.endTime}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                </Keyed>
              ))}
              {workingHours.error ? (
                <Text style={styles.error}>{workingHours.error}</Text>
              ) : null}
              {workingHours.hasChanges() && (
                <AppButton
                  title={workingHours.saving ? t('staff.saving') : t('staff.saveHours')}
                  onPress={async () => {
                    const result = await workingHours.save();
                    if (result.error) {
                      Alert.alert(t('common.error'), result.error);
                      return;
                    }
                    const n = result.cancelledAppointments ?? 0;
                    if (n > 0) {
                      Alert.alert(t('staff.workHoursOverlapTitle'), t('staff.workHoursOverlapBody', { count: n }));
                    } else {
                      Alert.alert(t('staff.savedOkTitle'), t('staff.savedHoursMsg'));
                    }
                  }}
                  variant="primary"
                  style={styles.saveBtn}
                  disabled={workingHours.saving}
                  loading={workingHours.saving}
                />
              )}
            </>
          )}
        </View>
        </ScreenEnter>
      </ScrollView>
      <WheelTimePickerSheet
        visible={!!timePicker}
        title={timePicker?.field === 'end' ? t('staff.timeEnd') : t('staff.timeStart')}
        valueHHMM={
          timePicker
            ? workingHours.days.find((x) => x.dayOfWeek === timePicker.dayOfWeek)?.[
                timePicker.field === 'start' ? 'startTime' : 'endTime'
              ] ?? '09:00'
            : '09:00'
        }
        onRequestClose={() => setTimePicker(null)}
        onConfirm={(time) => {
          const p = timePicker;
          if (!p) return;
          const day = workingHours.days.find((x) => x.dayOfWeek === p.dayOfWeek);
          if (!day) return;
          if (p.field === 'start') workingHours.setDayTimes(p.dayOfWeek, time, day.endTime);
          else workingHours.setDayTimes(p.dayOfWeek, day.startTime, time);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: presets.scrollContent,
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  hint: {
    ...textStyles.bodySmall,
    marginBottom: spacing.lg,
    textAlign: 'right',
  },
  loading: { ...textStyles.bodySmall, textAlign: 'center', marginVertical: spacing.lg },
  workDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  workDayToggle: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  workDayToggleActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  workDayToggleText: { fontSize: 15, fontWeight: '600', color: colors.text },
  workDayToggleTextActive: { color: colors.surface },
  workDayTimes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    direction: 'ltr',
  },
  timeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    minWidth: 72,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  timeInputText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  timeSeparator: { fontSize: 16, color: colors.textMuted },
  error: { ...textStyles.bodySmall, color: colors.danger, marginTop: spacing.sm, textAlign: 'right' },
  saveBtn: { marginTop: spacing.lg },
});
