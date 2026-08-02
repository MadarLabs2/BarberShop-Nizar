import React, { useCallback, useEffect, useMemo, useRef, memo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Linking,
  Platform,
  InteractionManager,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useDrawerStatus, type DrawerContentComponentProps } from '@react-navigation/drawer';
import { useAuth } from '../../hooks/useAuth';
import { countUnseenNotifications, countUnseenAppointments } from '../../contexts/BadgeSeenContext';
import { drawerMenuSnapshotRef } from '../../navigation/DrawerMenuSnapshotBridge';
import { BRAND_NAME } from '../../lib/config';
import { getDrawerMenuItems, canAccessDashboardCaps } from '../../lib/navigation.roles';
import type { DrawerMenuItem, MenuItemTarget } from '../../lib/navigation.roles';
import { LanguageSwitcher } from '../settings/LanguageSwitcher';
import { ScalePressable } from '../ui/ScalePressable';
import { useShopBranch } from '../../hooks/useShopBranch';
import { colors, radius } from '../../theme';

/** Visual section breaks without a line on every row (RTL drawer). */
function drawerSectionGapBefore(item: DrawerMenuItem, prev: DrawerMenuItem | null): boolean {
  if (!prev) return false;
  if (item.id === '1' && (prev.id === '0' || prev.id === '0b')) return true;
  if (item.id === '4' && prev.id === '3') return true;
  if (item.id === '7' && prev.id === '5') return true;
  if (item.id === '8' && prev.id === '7') return true;
  return false;
}

function DrawerContentInner(props: DrawerContentComponentProps) {
  const { t } = useTranslation();
  const drawerStatus = useDrawerStatus();
  const { user, isLoggedIn, logout, token, isAdmin, hasStaffProfile, isPureCustomer } = useAuth();
  const hasDashboardAccess = canAccessDashboardCaps(isAdmin, hasStaffProfile);

  /**
   * Badges: lists + last-seen come from `drawerMenuSnapshotRef` (updated by `DrawerMenuSnapshotBridge`) so this
   * component does not subscribe to appointments/notifications contexts — no re-renders on every prefetch.
   * On transition to open only: update counts next frame (does not wait for unrelated InteractionManager work).
   */
  const badgeSnapshotRef = useRef({ upcoming: 0, unread: 0 });
  const drawerWasOpenRef = useRef(false);
  const [badges, setBadges] = useState(() => ({ ...badgeSnapshotRef.current }));

  /** Admin-editable shop Instagram — first active branch, kept in sync via customer prefetch cache. */
  const shopBranch = useShopBranch();

  useEffect(() => {
    const open = drawerStatus === 'open';
    const justOpened = open && !drawerWasOpenRef.current;
    drawerWasOpenRef.current = open;
    if (!open || !justOpened) return;

    // Use InteractionManager so badge numbers update AFTER the drawer slide-in animation
    // finishes — updating state mid-animation caused the visible flicker (מהבהב).
    const handle = InteractionManager.runAfterInteractions(() => {
      setBadges((prev) => {
        const snap = drawerMenuSnapshotRef;
        const u =
          token && snap.hydrated
            ? countUnseenAppointments(snap.upcoming, snap.past, snap.appointmentsLastSeenMs)
            : 0;
        const r =
          token && snap.hydrated
            ? countUnseenNotifications(snap.notifications, snap.notificationsLastSeenMs)
            : 0;
        if (prev.upcoming === u && prev.unread === r) return prev;
        const next = { upcoming: u, unread: r };
        badgeSnapshotRef.current = next;
        return next;
      });
    });
    return () => handle.cancel();
  }, [drawerStatus, token]);

  useEffect(() => {
    if (drawerStatus === 'open') return;
    badgeSnapshotRef.current = badges;
  }, [drawerStatus, badges]);

  const greetingLabel = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return t('drawer.morning');
    if (h < 17) return t('drawer.afternoon');
    return t('drawer.evening');
  }, [t]);

  /** Structure only — badge numbers applied in render so list identity stays stable when counts change. */
  const menuItems = useMemo(
    () =>
      getDrawerMenuItems({
        isAdmin,
        hasStaffProfile,
        isLoggedIn,
        badges: { upcomingCount: 0, unreadCount: 0 },
      }),
    [isAdmin, hasStaffProfile, isLoggedIn],
  );

  const navigateAfterDrawerClose = useCallback(
    (name: string, params?: object) => {
      // Navigate directly — with drawerType:'front' the drawer closes automatically
      // when navigation fires. The old pattern (closeDrawer → InteractionManager → navigate)
      // created two sequential operations: the user felt a dead pause between tap and screen.
      // Direct navigate = drawer close + screen transition happen together, feels instant.
      (props.navigation.navigate as (routeName: string, routeParams?: object) => void)(name, params);
    },
    [props.navigation],
  );

  const openDashboard = useCallback(() => {
    navigateAfterDrawerClose(isAdmin ? 'Dashboard' : 'StaffDashboard');
  }, [navigateAfterDrawerClose, isAdmin]);

  const handleNavigation = useCallback(
    async (target: MenuItemTarget) => {
      if (!target) return;
      if (target.isLogout) {
        logout();
        props.navigation.closeDrawer();
        return;
      }
      if (target.isDashboard) {
        const dest = target.dashboardTarget === 'staff' ? 'StaffDashboard' : 'Dashboard';
        navigateAfterDrawerClose(dest);
        return;
      }
      const needsAuth =
        target.name === 'Booking' || target.name === 'Appointments' || target.name === 'Notifications';
      if (needsAuth && !isLoggedIn) {
        navigateAfterDrawerClose('Login');
        return;
      }
      if (target.name) {
          navigateAfterDrawerClose(target.name, target.params ?? undefined);
      }
    },
    [logout, props.navigation, navigateAfterDrawerClose, isLoggedIn, token, isPureCustomer],
  );

  const onCloseDrawer = useCallback(() => {
    props.navigation.closeDrawer();
  }, [props.navigation]);

  const onGuestLogin = useCallback(() => {
    (props.navigation.navigate as (routeName: string) => void)('Login');
  }, [props.navigation]);

  const onFooterBrandPress = useCallback(() => {
    const url = shopBranch?.instagramUrl;
    if (!url) return;
    const username = url.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/+$/, '');
    const deepLink = `instagram://user?username=${username}`;
    void Linking.canOpenURL(deepLink)
      .then((canOpen) => Linking.openURL(canOpen ? deepLink : url))
      .catch(() => Linking.openURL(url));
  }, [shopBranch]);

  const avatarSource = useMemo(
    () => (user?.avatarUrl ? { uri: user.avatarUrl } : null),
    [user?.avatarUrl],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        {hasDashboardAccess ? (
          <TouchableOpacity style={styles.dashboardButton} onPress={openDashboard} activeOpacity={0.7}>
            <Text style={styles.dashboardButtonText}>
              {isAdmin ? t('drawer.dashboard') : t('drawer.myAppointments')}
            </Text>
            <Ionicons name={isAdmin ? 'grid-outline' : 'calendar-outline'} size={24} color={colors.accent} />
          </TouchableOpacity>
        ) : (
          <View style={styles.topBarSpacer} />
        )}
        <View style={styles.topBarSpacer} />
        <View style={styles.topBarActions}>
          <LanguageSwitcher variant="header" />
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onCloseDrawer}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('common.closeA11y')}
          >
            <Ionicons name="close" size={28} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.header}>
        {isLoggedIn && user ? (
          <View style={styles.userSection}>
            <View style={styles.userInfo}>
              <Text style={styles.greeting}>{greetingLabel}</Text>
              <Text style={styles.userName} numberOfLines={1}>
                {user.firstName} {user.lastName}
              </Text>
            </View>
            <View style={styles.avatar}>
              {avatarSource ? (
                <ExpoImage
                  source={avatarSource}
                  style={styles.avatarImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              ) : (
                <Ionicons name="person" size={36} color={colors.textMuted} />
              )}
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.greeting}>{t('drawer.guestHello')}</Text>
            <TouchableOpacity style={styles.loginPrompt} onPress={onGuestLogin}>
              <Ionicons name="chevron-back" size={20} color={colors.text} />
              <Text style={styles.loginPromptText}>{t('drawer.tapLogin')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <ScrollView
        style={styles.menu}
        contentContainerStyle={styles.menuContent}
        removeClippedSubviews={Platform.OS === 'android'}
        keyboardShouldPersistTaps="handled"
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
      >
        {menuItems.map((item, index) => {
          const prev = index > 0 ? menuItems[index - 1]! : null;
          const sectionGap = drawerSectionGapBefore(item, prev);
          const rowBadge =
            item.id === '4' && badges.upcoming > 0
              ? badges.upcoming
              : item.id === '6' && badges.unread > 0
                ? badges.unread
                : null;
          return (
            <ScalePressable
              key={item.id}
              style={[
                styles.menuItem,
                sectionGap && styles.menuItemSectionGap,
              ]}
              onPress={() => handleNavigation(item.target)}
              android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
            >
              <Text
                style={[
                  styles.menuItemText,
                  item.id === '8' && styles.menuItemTextLogout,
                  (item.id === '0' || item.id === '0b') && styles.menuItemTextDashboard,
                ]}
              >
                {t(item.titleKey)}
              </Text>
              <View style={styles.menuItemIconWrap}>
                {rowBadge != null ? (
                  <View style={styles.iconWithBadge}>
                    <Ionicons
                      name={item.icon as keyof typeof Ionicons.glyphMap}
                      size={24}
                      color={item.id === '8' ? colors.danger : item.id === '0' || item.id === '0b' ? colors.accent : colors.text}
                    />
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{rowBadge}</Text>
                    </View>
                  </View>
                ) : (
                  <Ionicons
                    name={item.icon as keyof typeof Ionicons.glyphMap}
                    size={24}
                    color={item.id === '8' ? colors.danger : item.id === '0' || item.id === '0b' ? colors.accent : colors.text}
                  />
                )}
              </View>
            </ScalePressable>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.footerBrandPress}
          onPress={onFooterBrandPress}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={BRAND_NAME}
        >
          <Text style={styles.logoText}>{BRAND_NAME}</Text>
          <Ionicons name="logo-instagram" size={18} color={colors.accent} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export const DrawerContent = memo(DrawerContentInner);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  /** RTL: close on the left, «התורים שלי» / dashboard on the right */
  topBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  topBarSpacer: { flex: 1 },
  /** Same control style as Home header: language switch + close grouped on drawer leading edge */
  topBarActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: 88,
    gap: 2,
  },
  /** RTL: label on the right, icon to its left toward center */
  dashboardButton: { flexDirection: 'row-reverse', alignItems: 'center', padding: 8, gap: 6 },
  dashboardButtonText: { fontSize: 16, fontWeight: '600', color: colors.accent },
  closeButton: { padding: 8 },
  header: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  /** RTL: greeting + name on the right, avatar on their left */
  userSection: { flexDirection: 'row-reverse', alignItems: 'center', gap: 14 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  userInfo: { flex: 1, alignItems: 'flex-end' },
  greeting: { fontSize: 14, color: colors.textMuted, marginBottom: 2, textAlign: 'right', writingDirection: 'rtl' },
  userName: { fontSize: 18, fontWeight: 'bold', color: colors.text, textAlign: 'right', writingDirection: 'rtl' },
  loginPrompt: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.background,
    borderRadius: 12,
    alignSelf: 'flex-end',
    gap: 8,
  },
  loginPromptText: { fontSize: 16, color: colors.text, textAlign: 'right', writingDirection: 'rtl' },
  menu: { flex: 1 },
  menuContent: { paddingTop: 8, paddingBottom: 16 },
  /** RTL: label flush right, icon to its left — no per-row border (softer list) */
  menuItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginHorizontal: 10,
    overflow: 'hidden',
  },
  menuItemSectionGap: {
    marginTop: 14,
  },
  menuItemPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  menuItemIconWrap: { minWidth: 28, alignItems: 'center', justifyContent: 'center' },
  iconWithBadge: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -6,
    left: -8,
    backgroundColor: colors.danger,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: colors.surface, fontSize: 11, fontWeight: 'bold' },
  menuItemText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
    textAlign: 'right',
  },
  menuItemTextLogout: { color: colors.danger, fontWeight: '600' },
  menuItemTextDashboard: { color: colors.accent, fontWeight: '600' },
  /** RTL: brand name before clock icon (reading from the right) */
  footer: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  logoText: { fontSize: 16, fontWeight: '600', color: colors.text },
  footerBrandPress: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: radius.full,
  },
});
