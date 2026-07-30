import { useEffect, useCallback, useLayoutEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Alert,
  Modal,
  Platform,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
  useWindowDimensions,
  InteractionManager,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { AppButton } from '../../components/ui/AppButton';
import { EmptyState } from '../../components/feedback/EmptyState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { useNavigation } from '@react-navigation/native';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import type { RootDrawerParamList } from '../../navigation/paramList';

type DashboardNav = { navigate: (name: string) => void; openDrawer?: () => void };
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { Keyed } from '../../components/ui/Keyed';
import { useAuth } from '../../hooks/useAuth';
import { useDashboard } from '../../hooks/useDashboard';
import { prefetchAdminBlockedSlots } from '../../hooks/useAdminBlockedSlots';
import { openDrawer } from '../../utils/nav';
import { formatIsoDateDmy, getTodayDateString, parseYyyyMmDdToDate, toDateString } from '../../utils/dates';
import { isValidDateString } from '../../utils/validators';
import { WheelTimePickerSheet } from '../../components/ui/WheelTimePickerSheet';
import { colors, spacing, typography, radius, shadows, presets, textStyles, iconSize, layout } from '../../theme';
import { prefetchAdminCatalog } from '../../hooks/useAdminCatalog';
import { warmStaffReportsFromCatalog } from '../../services/staffReportCache';
import { prefetchAdminProducts } from '../../hooks/useAdminProducts';
import { prefetchAdminHeavyData } from '../../services/adminPrefetchCache';
import { localizeCatalogString, useAppLocale } from '../../contexts/LocaleContext';

function formatUpdatesFeedDate(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return isoDate;
  return formatIsoDateDmy(isoDate);
}

export function DashboardScreen() {
  const { t } = useTranslation();
  const { locale, pickerLocale } = useAppLocale();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const navigation = useNavigation<DashboardNav>();
  const { token, fetchCurrentUser, isAdmin, hasStaffProfile } = useAuth();
  const canShowAdminHub = !!token && isAdmin;
  const d = useDashboard(token, fetchCurrentUser);

  /** Non-admin staff accounts use the staff hub, not the admin management dashboard. */
  useLayoutEffect(() => {
    if (token && hasStaffProfile && !isAdmin) {
      (navigation as unknown as DrawerNavigationProp<RootDrawerParamList>).navigate('StaffDashboard');
    }
  }, [token, hasStaffProfile, isAdmin, navigation]);

  const warmAdminManagementData = useCallback(() => {
    if (!token) return;
    void prefetchAdminCatalog(token);
    void prefetchAdminProducts(token);
    void prefetchAdminHeavyData(token);
  }, [token]);

  /** Heavy waitlist / schedules / customers — defer until after transition so the screen stays responsive. */
  useEffect(() => {
    if (!isAdmin || !token) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      void prefetchAdminHeavyData(token);
    });
    return () => handle.cancel();
  }, [isAdmin, token]);

  useEffect(() => {
    if (isAdmin && d.activeTab === 'management' && token) {
      void prefetchAdminCatalog(token);
      void prefetchAdminProducts(token);
    }
  }, [isAdmin, d.activeTab, token]);

  useEffect(() => {
    if (!token) return;
    if (!canShowAdminHub) {
      if (hasStaffProfile && !isAdmin) return;
      (navigation.navigate as (name: string) => void)('Home');
    }
  }, [token, canShowAdminHub, hasStaffProfile, isAdmin, navigation]);

  const headerTitle =
    d.activeTab === 'updates' ? t('admin.updates') : d.activeTab === 'management' ? t('admin.management') : t('admin.appointmentsTab');

  const handleBroadcastSend = async () => {
    const result = await d.handleBroadcastSend();
    if (result?.success) {
      if ('queued' in result && typeof result.queued === 'number') {
        Alert.alert(
          t('admin.success'),
          result.queued === 0
            ? t('admin.broadcastWaitlistNone')
            : t('admin.broadcastWaitlistQueued', { count: result.queued })
        );
      } else if ('sent' in result && typeof result.sent === 'number') {
        Alert.alert(
          t('admin.success'),
          result.sent === 0
            ? t('admin.broadcastWaitlistNone')
            : t('admin.broadcastWaitlistSent', { count: result.sent })
        );
      } else {
        Alert.alert(t('admin.success'), t('admin.broadcastAllOk'));
      }
    } else if (result?.error) Alert.alert(t('admin.error'), result.error);
  };

  if (!token || !canShowAdminHub) {
    return null;
  }

  return (
    <Screen style={styles.container} noPadding>
      <BlackHeader
        title={headerTitle}
        onBackPress={() => navigation.navigate('Home')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />

      {isAdmin && (
        <View style={styles.tabBar}>
          <TouchableOpacity style={[styles.tab, d.activeTab === 'updates' && styles.tabActive]} onPress={() => d.setActiveTab('updates')} activeOpacity={0.8}>
            <Text style={[styles.tabText, d.activeTab === 'updates' && styles.tabTextActive]}>{t('admin.updates')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, d.activeTab === 'appointments' && styles.tabActive]} onPress={() => d.setActiveTab('appointments')} activeOpacity={0.8}>
            <Text style={[styles.tabText, d.activeTab === 'appointments' && styles.tabTextActive]}>{t('admin.appointmentsTab')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, d.activeTab === 'management' && styles.tabActive]} onPress={() => d.setActiveTab('management')} activeOpacity={0.8}>
            <Text style={[styles.tabText, d.activeTab === 'management' && styles.tabTextActive]}>{t('admin.management')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Admin tab: Updates — activity feed */}
      {d.activeTab === 'updates' && isAdmin ? (
        <ScrollView
          key="dashboard-tab-updates"
          style={styles.scroll}
          contentContainerStyle={dashStyles.mgmtContent}
          refreshControl={<RefreshControl refreshing={d.refreshing} onRefresh={d.onRefresh} />}
        >
          <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
          <View style={dashStyles.tabHero}>
            <Text style={dashStyles.tabHeroKicker}>{t('admin.dashFeedKicker')}</Text>
            <Text style={dashStyles.tabHeroTitle}>{t('admin.dashFeedTitle')}</Text>
          </View>

          {d.loading ? (
            <View style={dashStyles.loadingWrap}>
              <LoadingState />
            </View>
          ) : d.updatesFeed.length > 0 ? (
            <>
              <Text style={dashStyles.sectionLabel}>
                {t('admin.dashLastActivity')}
                <Text style={dashStyles.sectionLabelMuted}> · {Math.min(d.updatesFeed.length, 20)}</Text>
              </Text>
              <View style={dashStyles.groupedList}>
                {d.updatesFeed.slice(0, 20).map((item, idx, arr) => (
                  <Keyed key={item.id}>
                    <View style={[dashStyles.mgmtRow, idx < arr.length - 1 && dashStyles.groupedRowDivider]}>
                      <View style={dashStyles.mgmtRowIcon}>
                        <Ionicons name="calendar-outline" size={iconSize.lg} color={colors.accent} />
                      </View>
                      <View style={dashStyles.mgmtCardBody}>
                        <Text style={dashStyles.mgmtCardTitle} numberOfLines={2}>
                          {item.clientName}
                        </Text>
                        <Text style={dashStyles.mgmtCardSub} numberOfLines={3}>
                          {t('admin.dashBookingLine', {
                            service: localizeCatalogString(item.serviceName, locale),
                            staff: item.staffName,
                          })}
                        </Text>
                        <View style={dashStyles.updateMeta}>
                          <Ionicons name="time-outline" size={iconSize.sm} color={colors.textTertiary} />
                          <Text style={dashStyles.updateMetaText}>
                            {formatUpdatesFeedDate(item.date)}
                            {item.time ? ` · ${item.time}` : ''}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Keyed>
                ))}
              </View>
            </>
          ) : (
            <View style={dashStyles.emptyGrouped}>
              <EmptyState message={t('admin.emptyUpdates')} icon="notifications-outline" />
            </View>
          )}
          </ScreenEnter>
        </ScrollView>
      ) : d.activeTab === 'management' && isAdmin ? (
        <ScrollView
          key="dashboard-tab-management"
          style={styles.scroll}
          contentContainerStyle={dashStyles.mgmtContent}
          refreshControl={<RefreshControl refreshing={d.refreshing} onRefresh={d.onRefresh} />}
        >
          <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
          <View style={dashStyles.tabHero}>
            <Text style={dashStyles.tabHeroKicker}>{t('admin.dashMgmtKicker')}</Text>
            <Text style={dashStyles.tabHeroTitle}>{t('admin.dashMgmtTitle')}</Text>
          </View>

          <Text style={dashStyles.sectionLabel}>{t('admin.dashMessagesSection')}</Text>
          <View style={dashStyles.groupedList}>
            <TouchableOpacity
              style={[dashStyles.mgmtRow, dashStyles.groupedRowDivider]}
              onPress={() => {
                d.setBroadcastScope('all');
                d.setBroadcastModalVisible(true);
              }}
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="megaphone-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('admin.dashBroadcastAllCardTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('admin.dashBroadcastAllCardSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={dashStyles.mgmtRow}
              onPress={() => {
                d.setBroadcastScope('waitlist');
                d.setBroadcastStaffId((prev) => prev || d.staffList[0]?.id || '');
                d.setBroadcastModalVisible(true);
              }}
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="hourglass-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('admin.dashBroadcastWaitCardTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('admin.dashBroadcastWaitCardSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
          </View>

          <Text style={[dashStyles.sectionLabel, dashStyles.sectionLabelSpaced]}>{t('admin.dashReportsSection')}</Text>
          <View style={dashStyles.groupedList}>
            <TouchableOpacity
              style={dashStyles.mgmtRow}
              onPressIn={() => {
                warmAdminManagementData();
                if (token) warmStaffReportsFromCatalog(token);
              }}
              onPress={() =>
                (navigation.navigate as (name: string, params?: object) => void)('AdminStaffReportHub')
              }
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="bar-chart-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('admin.dashStaffReportsCardTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('admin.dashStaffReportsCardSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
          </View>

          <Text style={[dashStyles.sectionLabel, dashStyles.sectionLabelSpaced]}>{t('admin.dashCatalogSection')}</Text>
          <View style={dashStyles.groupedList}>
            {[
              { tab: 'staff' as const, titleKey: 'admin.staff', subKey: 'admin.staffSub', icon: 'people' as const },
              { tab: 'services' as const, titleKey: 'admin.services', subKey: 'admin.servicesSub', icon: 'cut' as const },
              { tab: 'workdays' as const, titleKey: 'admin.workdays', subKey: 'admin.workdaysSub', icon: 'calendar-outline' as const },
              { tab: 'branches' as const, titleKey: 'admin.branches', subKey: 'admin.branchesSub', icon: 'business' as const },
            ].map(({ tab, titleKey, subKey, icon }, idx) => (
              <TouchableOpacity
                key={tab}
                style={[dashStyles.mgmtRow, idx < 4 && dashStyles.groupedRowDivider]}
                onPressIn={warmAdminManagementData}
                onPress={() => (navigation.navigate as (name: string, params?: object) => void)('Admin', { tab })}
                activeOpacity={0.82}
              >
                <View style={dashStyles.mgmtRowIcon}>
                  <Ionicons
                    name={
                      icon === 'people'
                        ? 'people-outline'
                        : icon === 'cut'
                          ? 'cut-outline'
                          : icon === 'calendar-outline'
                            ? 'calendar-outline'
                            : 'business-outline'
                    }
                    size={iconSize.lg}
                    color={colors.accent}
                  />
                </View>
                <View style={dashStyles.mgmtCardBody}>
                  <Text style={dashStyles.mgmtCardTitle}>{t(titleKey)}</Text>
                  <Text style={dashStyles.mgmtCardSub}>{t(subKey)}</Text>
                </View>
                <View style={dashStyles.mgmtRowChevron}>
                  <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[dashStyles.mgmtRow, dashStyles.groupedRowDivider]}
              onPressIn={() => {
                if (token) void prefetchAdminProducts(token);
              }}
              onPress={() => (navigation.navigate as (name: string) => void)('AdminProducts')}
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="cube-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('admin.dashProductsCardTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('admin.dashProductsCardSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[dashStyles.mgmtRow, dashStyles.groupedRowDivider]}
              onPress={() => (navigation.navigate as (name: string) => void)('AdminStories')}
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="aperture-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('admin.dashStoriesCardTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('admin.dashStoriesCardSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={dashStyles.mgmtRow}
              onPressIn={warmAdminManagementData}
              onPress={() => (navigation.navigate as (name: string) => void)('AdminCustomers')}
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="people-circle-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('admin.dashCustomersCardTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('admin.dashCustomersCardSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
          </View>
          </ScreenEnter>
        </ScrollView>
      ) : d.activeTab === 'appointments' && isAdmin ? (
        <ScrollView
          key="dashboard-tab-appointments"
          style={styles.scroll}
          contentContainerStyle={dashStyles.mgmtContent}
          refreshControl={<RefreshControl refreshing={d.refreshing} onRefresh={d.onRefresh} />}
        >
          <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
          <View style={dashStyles.tabHero}>
            <Text style={dashStyles.tabHeroKicker}>{t('admin.dashOpsKicker')}</Text>
            <Text style={dashStyles.tabHeroTitle}>{t('admin.dashOpsTitle')}</Text>
          </View>

          <Text style={dashStyles.sectionLabel}>{t('admin.dashWhatNow')}</Text>
          <View style={dashStyles.groupedList}>
            <TouchableOpacity
              style={[dashStyles.mgmtRow, dashStyles.groupedRowDivider]}
              onPress={() => navigation.navigate('Booking')}
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="add-circle-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('admin.dashAddApptTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('admin.dashAddApptSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[dashStyles.mgmtRow, dashStyles.groupedRowDivider]}
              onPressIn={() => prefetchAdminBlockedSlots(token, d.opStaffId || d.staffList[0]?.id || null)}
              onPress={() =>
                (navigation.navigate as (name: string, params?: { staffId?: string }) => void)('AdminBlockedTimes', {
                  staffId: d.opStaffId || d.staffList[0]?.id || undefined,
                })
              }
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="lock-closed-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('admin.dashBlockApptTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('admin.dashBlockApptSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[dashStyles.mgmtRow, dashStyles.groupedRowDivider]}
              onPressIn={warmAdminManagementData}
              onPress={() => (navigation.navigate as (name: string) => void)('AdminStaffSchedule')}
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="calendar-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('admin.dashScheduleCardTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('admin.dashScheduleCardSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={dashStyles.mgmtRow}
              onPressIn={warmAdminManagementData}
              onPress={() => (navigation.navigate as (name: string) => void)('AdminWaitlist')}
              activeOpacity={0.82}
            >
              <View style={dashStyles.mgmtRowIcon}>
                <Ionicons name="people-outline" size={iconSize.lg} color={colors.accent} />
              </View>
              <View style={dashStyles.mgmtCardBody}>
                <Text style={dashStyles.mgmtCardTitle}>{t('admin.dashWaitlistCardTitle')}</Text>
                <Text style={dashStyles.mgmtCardSub}>{t('admin.dashWaitlistCardSub')}</Text>
              </View>
              <View style={dashStyles.mgmtRowChevron}>
                <Ionicons name="chevron-back" size={iconSize.md} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
          </View>
          </ScreenEnter>
        </ScrollView>
      ) : (
        /* Staff / default view: stats + upcoming appointments (staff sees this when backend supports staffId) */
        <ScrollView
          key={`dashboard-default-${d.activeTab}-${isAdmin ? 'admin' : 'staff'}`}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={d.refreshing} onRefresh={d.onRefresh} />}
        >
          <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
          {d.loading && !d.summary ? (
            <View style={dashStyles.loadingWrap}><LoadingState /></View>
          ) : (
            <>
              <View style={styles.statsCard}>
                <View style={styles.statsRow}>
                  <View style={styles.statBox}>
                    <View style={styles.statIconWrap}>
                      <Ionicons name="business" size={28} color={colors.accent} />
                    </View>
                    <Text style={styles.statNum}>{d.summary?.branches ?? 0}</Text>
                    <Text style={styles.statLabel}>{t('admin.dashStatBranches')}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <View style={styles.statIconWrap}>
                      <Ionicons name="cut" size={28} color={colors.accent} />
                    </View>
                    <Text style={styles.statNum}>{d.summary?.services ?? 0}</Text>
                    <Text style={styles.statLabel}>{t('admin.dashStatServices')}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <View style={styles.statIconWrap}>
                      <Ionicons name="people" size={28} color={colors.accent} />
                    </View>
                    <Text style={styles.statNum}>{d.summary?.staff ?? 0}</Text>
                    <Text style={styles.statLabel}>{t('admin.dashStatStaff')}</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.sectionTitle}>{t('admin.dashUpcomingTitle')}</Text>
              {d.upcoming.length === 0 ? (
                <View style={dashStyles.emptyWrap}>
                  <EmptyState message={t('admin.upcomingEmpty')} icon="calendar-outline" />
                </View>
              ) : (
                d.upcoming.map((apt) => (
                  <Keyed key={apt.id}>
                  <View style={styles.aptCard}>
                    <View style={styles.aptMain}>
                      <Text style={styles.aptTimeRange}>{apt.time}</Text>
                      <Text style={styles.aptName}>{localizeCatalogString(apt.serviceName, locale)}</Text>
                      <Text style={styles.aptService}>
                        {t('admin.dashAtStaffBranch', {
                          staff: apt.staffName,
                          branch: localizeCatalogString(apt.branchName, locale),
                        })}
                      </Text>
                    </View>
                    <View style={styles.aptAvatar}>
                      <Ionicons name="person" size={iconSize.lg} color={colors.textMuted} />
                    </View>
                  </View>
                  </Keyed>
                ))
              )}

              {isAdmin && (
                <TouchableOpacity style={styles.adminBtn} onPress={() => navigation.navigate('Admin')} activeOpacity={0.85}>
                  <Ionicons name="settings" size={iconSize.lg} color={colors.surface} />
                  <Text style={styles.adminBtnText}>{t('admin.dashManageCatalogBtn')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          </ScreenEnter>
        </ScrollView>
      )}

      {isAdmin && d.activeTab === 'appointments' && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('Booking')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('admin.newAppointmentA11y')}
        >
          <Ionicons name="add" size={28} color={colors.surface} />
        </TouchableOpacity>
      )}

      <Modal visible={d.broadcastModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          style={dashStyles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'position' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? -12 : 0}
        >
          <Pressable style={dashStyles.backdropTapTarget} onPress={Keyboard.dismiss} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={dashStyles.modalOverlayScroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={dashStyles.modalContent}>
              <Text style={dashStyles.modalTitle}>
                {d.broadcastScope === 'waitlist' ? t('admin.broadcastTitleWaitlist') : t('admin.broadcastTitleAll')}
              </Text>
              <Text style={dashStyles.modalScopeHint}>
                {d.broadcastScope === 'waitlist' ? t('admin.broadcastHintWaitlist') : t('admin.broadcastHintAll')}
              </Text>
              {d.broadcastScope === 'waitlist' ? (
                <>
                  <Text style={dashStyles.modalLabel}>{t('admin.labelStaff')}</Text>
                  <ScrollView horizontal style={dashStyles.modalChips} contentContainerStyle={dashStyles.modalChipsWrap}>
                    {d.staffList.map((s) => (
                      <TouchableOpacity
                        key={s.id}
                        style={[dashStyles.modalChip, d.broadcastStaffId === s.id && dashStyles.modalChipActive]}
                        onPress={() => d.setBroadcastStaffId(s.id)}
                      >
                        <Text
                          style={[dashStyles.modalChipText, d.broadcastStaffId === s.id && dashStyles.modalChipTextActive]}
                        >
                          {s.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              ) : null}
              <Text style={dashStyles.modalLabel}>{t('admin.titlePlaceholder')}</Text>
              <TextInput
                style={dashStyles.modalInput}
                placeholder={t('admin.titlePlaceholder')}
                value={d.broadcastForm.title}
                onChangeText={(v) => d.setBroadcastForm((f) => ({ ...f, title: v }))}
                placeholderTextColor={colors.textMuted}
              />
              <Text style={dashStyles.modalLabel}>{t('admin.labelBodyOptional')}</Text>
              <TextInput
                style={[dashStyles.modalInput, dashStyles.modalInputArea]}
                placeholder={t('admin.bodyPlaceholder')}
                value={d.broadcastForm.body}
                onChangeText={(v) => d.setBroadcastForm((f) => ({ ...f, body: v }))}
                placeholderTextColor={colors.textMuted}
                multiline
              />
              <View style={dashStyles.modalBtns}>
                <AppButton
                  title={t('admin.cancel')}
                  variant="secondary"
                  onPress={() => {
                    d.setBroadcastModalVisible(false);
                    d.setBroadcastScope('all');
                  }}
                />
                <AppButton
                  title={t('admin.send')}
                  variant="primary"
                  onPress={handleBroadcastSend}
                  disabled={
                    !d.broadcastForm.title.trim() ||
                    d.broadcastSaving ||
                    (d.broadcastScope === 'waitlist' && !d.broadcastStaffId)
                  }
                  loading={d.broadcastSaving}
                />
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabBar: {
    flexDirection: 'row-reverse',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  tab: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.background,
  },
  tabActive: { backgroundColor: colors.accent },
  tabText: { fontSize: 15, color: colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: colors.surface, fontWeight: '700' },
  emptyText: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
  scroll: { flex: 1 },
  scrollContent: { ...presets.scrollContent },
  statsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.cardStrong,
  },
  statsRow: { flexDirection: 'row-reverse', justifyContent: 'space-around' },
  statBox: { alignItems: 'center' },
  statIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent + '25',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statNum: { ...typography.title, color: colors.primary, marginTop: spacing.sm },
  statLabel: { ...typography.bodySmall, color: colors.textMuted, marginTop: spacing.xs },
  sectionTitle: { ...typography.titleSmall, fontSize: 18, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.lg, textAlign: 'right' },
  aptCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    ...shadows.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  aptMain: { flex: 1 },
  aptTimeRange: { fontSize: 15, fontWeight: '700', color: colors.text, textAlign: 'right' },
  aptName: { fontSize: 15, color: colors.text, fontWeight: '500', marginTop: spacing.xs, textAlign: 'right' },
  aptService: { fontSize: 13, color: colors.textMuted, marginTop: 2, textAlign: 'right' },
  aptAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  adminBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    marginTop: spacing.xl,
    ...shadows.card,
  },
  adminBtnText: { color: colors.surface, fontSize: 16, fontWeight: '600' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.card,
  },
});

const dashStyles = StyleSheet.create({
  loadingWrap: { flex: 1, minHeight: 120, justifyContent: 'center' },
  emptyWrap: { minHeight: 140, marginTop: spacing.lg },
  tabHero: {
    marginBottom: spacing.lg,
  },
  tabHeroKicker: {
    ...textStyles.heroKicker,
    fontSize: 11,
    marginBottom: spacing.xs,
    textAlign: 'right',
  },
  tabHeroTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'right',
    letterSpacing: -0.3,
    marginBottom: spacing.xs,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'right',
    marginBottom: spacing.sm,
  },
  sectionLabelMuted: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  sectionLabelSpaced: { marginTop: spacing.xl },
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
  updateMeta: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    marginTop: spacing.xs,
  },
  updateMetaText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
    textAlign: 'right',
  },
  emptyGrouped: {
    marginTop: spacing.md,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  mgmtContent: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.md,
    paddingBottom: 100,
    backgroundColor: colors.background,
  },
  mgmtRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  /** Matches staff list avatar box (48) + Admin catalog row icon rhythm */
  mgmtRowIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.md,
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
  },
  mgmtCardSub: {
    ...textStyles.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  /** Block-appointment modal: full-screen root so date/time overlays are not clipped by padding */
  blockModalRoot: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  blockModalCentered: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  backdropTapTarget: {
    ...StyleSheet.absoluteFillObject,
  },
  modalOverlayScroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xs,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 0,
    overflow: 'hidden',
    ...shadows.cardStrong,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    textAlign: 'right',
    color: colors.primary,
  },
  modalScopeHint: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    textAlign: 'right',
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
    textAlign: 'right',
    paddingHorizontal: spacing.lg,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    marginBottom: spacing.md,
    marginHorizontal: spacing.lg,
    textAlign: 'right',
    backgroundColor: colors.background,
  },
  modalInputArea: { minHeight: 96, textAlignVertical: 'top' },
  modalChips: { marginBottom: 0, maxHeight: 120 },
  modalChipsWrap: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  modalChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalChipActive: {
    backgroundColor: colors.accent + '22',
    borderColor: colors.accent,
  },
  modalChipText: { fontSize: 14, color: colors.text, fontWeight: '500' },
  modalChipTextActive: { color: colors.accent, fontWeight: '700' },
  modalBtns: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
    direction: 'ltr',
  },
  /** Staff-style tappable rows (block modal) */
  modalPickerField: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    minHeight: 48,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.background,
  },
  modalPickerFieldText: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalPickerPlaceholder: {
    color: colors.textMuted,
  },
  /** Covers block modal; keeps iOS date sheet above the card without a nested Modal */
  blockPickerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1500,
    elevation: 20,
  },
  /** iOS inline calendar sheet (same pattern as AdminBlockedTimesScreen) */
  adminPickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    alignItems: 'stretch',
  },
  adminPickerSheet: {
    width: '100%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    maxHeight: '92%',
    alignSelf: 'stretch',
  },
  adminPickerSheetTitle: {
    ...textStyles.sectionTitle,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    color: colors.text,
  },
  adminPickerIosCalendarWrap: {
    width: '100%',
    minHeight: 340,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  adminPickerIosCalendarInner: {
    width: '100%',
    alignItems: 'center',
    direction: 'ltr',
  },
  adminPickerDone: {
    alignSelf: 'stretch',
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  adminPickerDoneText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.onPrimary,
  },
});
