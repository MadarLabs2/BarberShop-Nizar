import { useCallback, useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { PageIntro } from '../../components/ui/PageIntro';
import { EmptyState } from '../../components/feedback/EmptyState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { useAuth } from '../../hooks/useAuth';
import { openDrawer } from '../../utils/nav';
import { colors, spacing, radius, presets, shadows, textStyles, iconSize } from '../../theme';
import { canAccessAdmin } from '../../lib/navigation.roles';
import { getAdminWaitlist, cancelAdminWaitlistEntry, type WaitlistRow } from '../../services/admin.api';
import { fetchStaff } from '../../services/bookings.api';
import {
  getCachedWaitlistAll,
  setCachedWaitlistAll,
  filterWaitlistByStaff,
  prefetchAdminHeavyData,
} from '../../services/adminPrefetchCache';
import { localizeCatalogString, useAppLocale } from '../../contexts/LocaleContext';
import { formatDateDmy } from '../../utils/dates';

function prefsLabel(row: WaitlistRow, tr: TFunction): string {
  const parts: string[] = [];
  if (row.preferMorning) parts.push(tr('appointments.morning'));
  if (row.preferAfternoon) parts.push(tr('appointments.afternoon'));
  if (row.preferEvening) parts.push(tr('appointments.evening'));
  return parts.length ? parts.join(' · ') : tr('booking.dash');
}

export function AdminWaitlistScreen() {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const { token, role } = useAuth();
  const [allRows, setAllRows] = useState<WaitlistRow[]>(() => getCachedWaitlistAll() ?? []);
  const [staffOptions, setStaffOptions] = useState<{ id: string; name: string }[]>([]);
  const [filterStaffId, setFilterStaffId] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => getCachedWaitlistAll() === null);
  const [refreshing, setRefreshing] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const rows = useMemo(
    () => filterWaitlistByStaff(allRows, filterStaffId),
    [allRows, filterStaffId],
  );

  const loadAll = useCallback(
    async (opts?: { showRefreshing?: boolean }) => {
      if (!token) return;
      const hadCache = getCachedWaitlistAll() !== null;
      if (opts?.showRefreshing) setRefreshing(true);
      else if (!hadCache) setLoading(true);
      try {
        const data = await getAdminWaitlist(token);
        setCachedWaitlistAll(data);
        setAllRows(data);
      } catch {
        if (!hadCache) setAllRows([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  const requestRemoveRow = useCallback(
    (row: WaitlistRow) => {
      if (!token || removingId) return;
      Alert.alert(t('admin.waitlistRemoveTitle'), t('admin.waitlistRemoveBody', { name: row.clientName }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.waitlistRemoveAction'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setRemovingId(row.id);
              try {
                await cancelAdminWaitlistEntry(token, row.id);
                setAllRows((prev) => {
                  const next = prev.filter((r) => r.id !== row.id);
                  setCachedWaitlistAll(next);
                  return next;
                });
              } catch (e) {
                Alert.alert(t('common.error'), e instanceof Error ? e.message : t('admin.waitlistRemoveFailed'));
              } finally {
                setRemovingId(null);
              }
            })();
          },
        },
      ]);
    },
    [token, removingId, t],
  );

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const staff = await fetchStaff();
        setStaffOptions(staff.map((s) => ({ id: s.id, name: s.name })));
      } catch {
        setStaffOptions([]);
      }
    })();
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (!token || !canAccessAdmin(role)) {
        navigation.navigate('Home' as never);
        return;
      }
      const cached = getCachedWaitlistAll();
      if (cached !== null) {
        setAllRows(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
      void loadAll();
      void prefetchAdminHeavyData(token);
    }, [token, role, navigation, loadAll]),
  );

  if (!token || !canAccessAdmin(role)) {
    return null;
  }

  return (
    <Screen style={styles.container} noPadding>
      <BlackHeader
        title={t('admin.waitlistTitle')}
        onBackPress={() => navigation.navigate('Dashboard')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void loadAll({ showRefreshing: true })} />
        }
      >
        <ScreenEnter replayOnFocus remountKey={filterStaffId ?? 'all'} variant="rise" style={{ flexGrow: 1 }}>
        <PageIntro title={t('admin.waitlistPageTitle')} />
        <View style={styles.chipsOuter}>
          <View style={styles.chipsRow}>
            {staffOptions.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.chip, filterStaffId === s.id && styles.chipOn]}
                onPress={() => setFilterStaffId(s.id)}
              >
                <Text style={[styles.chipText, filterStaffId === s.id && styles.chipTextOn]} numberOfLines={1}>
                  {s.name}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.chip, filterStaffId === null && styles.chipOn]}
              onPress={() => setFilterStaffId(null)}
            >
              <Text style={[styles.chipText, filterStaffId === null && styles.chipTextOn]}>{t('admin.filterAll')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading && rows.length === 0 ? (
          <View style={styles.centered}>
            <LoadingState />
          </View>
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('admin.waitlistEmptyTitle')}
            message={t('admin.waitlistEmptyMsg')}
            icon="people-outline"
          />
        ) : (
          rows.map((row) => (
            <View key={row.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.staffName}>{row.staffName}</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {formatDateDmy(new Date(row.date + 'T12:00:00'))}
                  </Text>
                </View>
              </View>
              <Text style={styles.clientName}>{row.clientName}</Text>
              <Text style={styles.line}>{localizeCatalogString(row.serviceName, locale)}</Text>
              {row.branchName ? (
                <Text style={styles.muted}>{localizeCatalogString(row.branchName, locale)}</Text>
              ) : null}
              <View style={styles.prefs}>
                <Ionicons name="time-outline" size={iconSize.sm} color={colors.accent} />
                <Text style={styles.prefsText}>{prefsLabel(row, t)}</Text>
              </View>
              <Text style={styles.phone}>{row.clientPhone}</Text>
              <TouchableOpacity
                style={[styles.removeWaitlistBtn, removingId === row.id && styles.removeWaitlistBtnDisabled]}
                onPress={() => requestRemoveRow(row)}
                disabled={!!removingId}
                activeOpacity={0.75}
              >
                <Text style={styles.removeWaitlistBtnText}>{t('admin.waitlistRemoveFromList')}</Text>
              </TouchableOpacity>
            </View>
          ))
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
  chipsOuter: { width: '100%', alignSelf: 'stretch' },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    paddingVertical: spacing.xs,
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    maxWidth: 160,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accent + '18' },
  chipText: { ...textStyles.caption, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },
  chipTextOn: { color: colors.accent },
  centered: { paddingVertical: spacing.xl * 2, alignItems: 'center', minHeight: 160 },
  card: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  staffName: { ...textStyles.caption, fontWeight: '700', color: colors.accent, textAlign: 'right', flex: 1 },
  badge: { backgroundColor: colors.accent + '22', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.md },
  badgeText: { ...textStyles.caption, fontWeight: '700', color: colors.accent },
  clientName: { ...textStyles.sectionTitle, fontSize: 17, marginBottom: spacing.xs, textAlign: 'right' },
  line: { ...textStyles.bodyMedium, fontSize: 15, textAlign: 'right', marginBottom: spacing.xs },
  muted: { ...textStyles.bodySmall, textAlign: 'right', marginBottom: spacing.sm },
  prefs: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  prefsText: { ...textStyles.bodySmall, color: colors.text, fontWeight: '600' },
  phone: { ...textStyles.bodySmall, textAlign: 'right', marginTop: spacing.sm, direction: 'ltr' as const },
  removeWaitlistBtn: {
    marginTop: spacing.md,
    alignSelf: 'flex-end',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerMuted,
  },
  removeWaitlistBtnDisabled: { opacity: 0.55 },
  removeWaitlistBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.danger,
    textAlign: 'right',
  },
});
