import { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { useAuth } from '../../hooks/useAuth';
import { openDrawer } from '../../utils/nav';
import { colors, spacing, radius, textStyles, iconSize, layout, shadows } from '../../theme';
import { useStaffOperationalSurface } from '../../hooks/useStaffOperationalSurface';
import { prefetchStaffDashboardData } from '../../services/staffPrefetchCache';
import { prefetchMyStaffReport } from '../../services/staffReportCache';
import { prefetchStaffWaitlist } from '../../services/adminPrefetchCache';
import { prefetchMyBlockedSlots } from '../../hooks/useMyBlockedSlots';

export function StaffDashboardScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const { token, canBlockOwnTime, canSetOwnWorkingHours } = useAuth();
  const staffSurfaceOk = useStaffOperationalSurface();

  const warmStaffDashboard = useCallback(() => {
    if (token) void prefetchStaffDashboardData(token);
  }, [token]);

  useEffect(() => {
    if (token && staffSurfaceOk) {
      void prefetchStaffDashboardData(token);
      prefetchMyStaffReport(token);
    }
  }, [token, staffSurfaceOk]);

  useEffect(() => {
    if (!token || !staffSurfaceOk) {
      (navigation.navigate as (name: string) => void)('Home');
    }
  }, [token, staffSurfaceOk, navigation]);

  if (!token || !staffSurfaceOk) {
    return null;
  }

  return (
    <Screen style={styles.container} noPadding>
      <BlackHeader
        title={t('staff.dashboardTitle')}
        onBackPress={() => navigation.navigate('Home')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={dashStyles.mgmtContent}
        showsVerticalScrollIndicator={false}
      >
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
        <View style={dashStyles.tabHero}>
          <Text style={dashStyles.tabHeroKicker}>{t('admin.dashOpsKicker')}</Text>
          <Text style={dashStyles.tabHeroTitle}>{t('staff.dashboardCenterTitle')}</Text>
        </View>

        <Text style={dashStyles.sectionLabel}>{t('admin.dashWhatNow')}</Text>
        <View style={dashStyles.groupedList}>
          {canSetOwnWorkingHours && (
            <TouchableOpacity
              style={[dashStyles.mgmtRow, dashStyles.groupedRowDivider]}
              onPress={() => navigation.navigate('StaffWorkingHours')}
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="time-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('staff.hoursCardTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('staff.hoursCardSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
          )}

          {canBlockOwnTime && (
            <TouchableOpacity
              style={[dashStyles.mgmtRow, dashStyles.groupedRowDivider]}
              onPressIn={() => prefetchMyBlockedSlots(token)}
              onPress={() => navigation.navigate('StaffBlockedTimes')}
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="lock-closed-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('staff.blockedCardTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('staff.blockedCardSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[dashStyles.mgmtRow, dashStyles.groupedRowDivider]}
            onPressIn={warmStaffDashboard}
            onPress={() => navigation.navigate('StaffAppointments')}
            activeOpacity={0.82}
          >
            <View style={dashStyles.mgmtRowIcon}>
              <Ionicons name="calendar-outline" size={iconSize.lg} color={colors.accent} />
            </View>
            <View style={dashStyles.mgmtCardBody}>
              <Text style={dashStyles.mgmtCardTitle}>{t('staff.apptCardTitle')}</Text>
              <Text style={dashStyles.mgmtCardSub}>{t('staff.apptCardSub')}</Text>
            </View>
            <View style={dashStyles.mgmtRowChevron}>
              <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[dashStyles.mgmtRow, dashStyles.groupedRowDivider]}
            onPressIn={() => {
              warmStaffDashboard();
              if (token) void prefetchStaffWaitlist(token, { force: true });
            }}
            onPress={() => navigation.navigate('StaffWaitlist')}
            activeOpacity={0.82}
          >
            <View style={dashStyles.mgmtRowIcon}>
              <Ionicons name="people-outline" size={iconSize.lg} color={colors.accent} />
            </View>
            <View style={dashStyles.mgmtCardBody}>
              <Text style={dashStyles.mgmtCardTitle}>{t('staff.waitlistCardTitle')}</Text>
              <Text style={dashStyles.mgmtCardSub}>{t('staff.waitlistCardSub')}</Text>
            </View>
            <View style={dashStyles.mgmtRowChevron}>
              <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[dashStyles.mgmtRow, dashStyles.groupedRowDivider]}
            onPressIn={() => {
              if (token) prefetchMyStaffReport(token);
            }}
            onPress={() => navigation.navigate('StaffReport')}
            activeOpacity={0.82}
          >
            <View style={dashStyles.mgmtRowIcon}>
              <Ionicons name="bar-chart-outline" size={iconSize.lg} color={colors.accent} />
            </View>
            <View style={dashStyles.mgmtCardBody}>
              <Text style={dashStyles.mgmtCardTitle}>{t('staff.reportCardTitle')}</Text>
              <Text style={dashStyles.mgmtCardSub}>{t('staff.reportCardSub')}</Text>
            </View>
            <View style={dashStyles.mgmtRowChevron}>
              <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={dashStyles.mgmtRow}
            onPress={() => navigation.navigate('StaffStories')}
            activeOpacity={0.82}
          >
            <View style={dashStyles.mgmtRowIcon}>
              <Ionicons name="aperture-outline" size={iconSize.lg} color={colors.accent} />
            </View>
            <View style={dashStyles.mgmtCardBody}>
              <Text style={dashStyles.mgmtCardTitle}>{t('staff.storiesCardTitle')}</Text>
              <Text style={dashStyles.mgmtCardSub}>{t('staff.storiesCardSub')}</Text>
            </View>
            <View style={dashStyles.mgmtRowChevron}>
              <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
            </View>
          </TouchableOpacity>
        </View>
        </ScreenEnter>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
});

/** Mirrors admin `DashboardScreen` appointments-tab list (grouped card + rows). */
const dashStyles = StyleSheet.create({
  mgmtContent: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl + spacing.lg,
    backgroundColor: colors.background,
  },
  tabHero: {
    marginBottom: spacing.lg,
  },
  tabHeroKicker: {
    ...textStyles.heroKicker,
    fontSize: 11,
    marginBottom: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  tabHeroTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'right',
    letterSpacing: -0.3,
    marginBottom: spacing.xs,
    writingDirection: 'rtl',
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'right',
    marginBottom: spacing.sm,
    writingDirection: 'rtl',
  },
  groupedList: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  groupedRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  mgmtRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  mgmtRowIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginStart: spacing.md,
  },
  mgmtRowChevron: {
    padding: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mgmtCardBody: { flex: 1, minWidth: 0 },
  mgmtCardTitle: {
    ...textStyles.bodyMedium,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  mgmtCardSub: {
    ...textStyles.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
