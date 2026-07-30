import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { EmptyState } from '../../components/feedback/EmptyState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Keyed } from '../../components/ui/Keyed';
import { useAuth } from '../../hooks/useAuth';
import { openDrawer } from '../../utils/nav';
import { canAccessAdmin } from '../../lib/navigation.roles';
import type { Staff } from '../../services/admin.api';
import { prefetchAdminStaffReport, prefetchAdminStaffReportsBatch } from '../../services/staffReportCache';
import { formatPhoneDisplay } from '../../utils/phone';
import { colors, spacing, radius, textStyles, iconSize, layout, presets, shadows } from '../../theme';
import { peekAdminCatalogWarm, prefetchAdminCatalog } from '../../hooks/useAdminCatalog';

export function AdminStaffReportHubScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void; openDrawer?: () => void }>();
  const { token, role } = useAuth();
  const [staff, setStaff] = useState<Staff[]>(() => peekAdminCatalogWarm()?.staff.filter((s) => s.isActive) ?? []);
  const [loading, setLoading] = useState(() => !peekAdminCatalogWarm()?.staff?.length);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const cached = peekAdminCatalogWarm();
      if (cached?.staff?.length) {
        const activeCached = cached.staff.filter((s) => s.isActive);
        setStaff(activeCached);
        setLoading(false);
      }
      await prefetchAdminCatalog(token);
      const active = (peekAdminCatalogWarm()?.staff ?? []).filter((s) => s.isActive);
      setStaff(active);
      if (active.length > 0) {
        void prefetchAdminStaffReportsBatch(
          token,
          active.map((s) => s.id),
        );
      }
    } catch {
      setStaff([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      navigation.navigate('Login');
      return;
    }
    if (!canAccessAdmin(role)) {
      navigation.navigate('Dashboard');
      return;
    }
    void load();
  }, [token, role, navigation, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  if (!token || !canAccessAdmin(role)) {
    return null;
  }

  return (
    <Screen style={styles.container} noPadding>
      <BlackHeader
        title={t('admin.staffReportHubTitle')}
        onBackPress={() => navigation.navigate('Dashboard')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.intro}>{t('admin.staffReportHubSub')}</Text>
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
          {loading ? (
            <View style={styles.loadingWrap}>
              <LoadingState />
            </View>
          ) : staff.length === 0 ? (
            <EmptyState title={t('admin.emptyStaffTitle')} message={t('admin.emptyStaffMsg')} icon="people-outline" />
          ) : (
            staff.map((s) => (
              <Keyed key={s.id}>
                <TouchableOpacity
                  style={styles.row}
                  onPressIn={() => prefetchAdminStaffReport(token, s.id)}
                  onPress={() =>
                    navigation.navigate('AdminStaffReport', {
                      staffId: s.id,
                      staffName: s.name,
                      returnTo: 'hub',
                    })
                  }
                  activeOpacity={0.82}
                >
                  <View style={styles.avatarWrap}>
                    {s.avatarUrl ? (
                      <ExpoImage
                        source={{ uri: s.avatarUrl }}
                        style={styles.avatarImg}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={0}
                      />
                    ) : (
                      <View style={styles.avatarPh}>
                        <Ionicons name="person" size={22} color={colors.textMuted} />
                      </View>
                    )}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.name} numberOfLines={1}>
                      {s.name}
                    </Text>
                    {s.phone ? <Text style={styles.phone}>{formatPhoneDisplay(s.phone)}</Text> : null}
                  </View>
                  <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
                </TouchableOpacity>
              </Keyed>
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
  content: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  intro: {
    ...textStyles.bodySmall,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.lg,
  },
  loadingWrap: { minHeight: 160, justifyContent: 'center' },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderStartWidth: 3,
    borderStartColor: colors.accent,
    ...shadows.card,
  },
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarPh: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  rowBody: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  name: { ...textStyles.bodyMedium, textAlign: 'right', writingDirection: 'rtl' },
  phone: { ...textStyles.bodySmall, color: colors.textMuted, marginTop: 2, textAlign: 'right', writingDirection: 'rtl' },
});
