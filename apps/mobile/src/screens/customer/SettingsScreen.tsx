import { useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Linking, Pressable, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { ShelfStaggerEnter } from '../../components/ui/ShelfStaggerEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { PageIntro } from '../../components/ui/PageIntro';
import { AppButton } from '../../components/ui/AppButton';
import { useAuth } from '../../hooks/useAuth';
import { useNotifications } from '../../contexts/NotificationsContext';
import { openDrawer } from '../../utils/nav';
import type { RootDrawerParamList } from '../../navigation/paramList';
import { TERMS_URL, PRIVACY_URL } from '../../lib/config';
import {
  linkMyStaffProfile,
  unlinkMyStaffProfile,
  formatLinkMyStaffProfileError,
  formatUnlinkMyStaffProfileError,
} from '../../services/admin.api';
import { prefetchCustomerTabData } from '../../services/customerPrefetchCache';
import { clearCustomerPrefetchCaches, removeStaffFromTeamCache } from '../../services/customerPrefetchCache';
import { clearStaffSessionCaches } from '../../services/staffPrefetchCache';
import { clearAdminPrefetchCaches } from '../../services/adminPrefetchCache';
import { clearAdminDashboardCache } from '../../services/adminDashboardCache';
import { getAuthState } from '../../store/auth.store';
import { hasStaffProfile as authUserHasStaffRow } from '../../lib/roles';
import { colors, spacing, radius, presets, shadows, textStyles, iconSize } from '../../theme';

export function SettingsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<DrawerNavigationProp<RootDrawerParamList>>();
  const { user, isLoggedIn, logout, deleteAccount, isAdmin, hasStaffProfile, token, fetchCurrentUser, isRestored } = useAuth();
  const { notificationsEnabled, notificationsPrefsReady, setNotificationsEnabled, forceRefresh: forceNotificationsRefresh } = useNotifications();
  const showLinkStaffProfile = isRestored && isLoggedIn && isAdmin && !hasStaffProfile;
  const showUnlinkStaffProfile = isRestored && isLoggedIn && isAdmin && hasStaffProfile;
  const [linkingStaffProfile, setLinkingStaffProfile] = useState(false);
  const [unlinkingStaffProfile, setUnlinkingStaffProfile] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const linkingStaffInFlightRef = useRef(false);
  const unlinkingStaffInFlightRef = useRef(false);
  const deletingAccountInFlightRef = useRef(false);

  const notificationsShelfIndex = 1;
  const staffLinkShelfIndex = 2;
  const generalShelfIndex = showLinkStaffProfile || showUnlinkStaffProfile ? 3 : 2;

  const displayName = isLoggedIn && user
    ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || t('common.user')
    : t('common.user');

  const handleLogout = () => {
    logout();
    navigation.navigate('Home');
  };

  const handleTerms = () => {
    const url = TERMS_URL?.trim();
    if (url) {
      Linking.openURL(url);
    } else {
      navigation.navigate('LegalDocument', { document: 'terms', returnTo: 'Settings' });
    }
  };

  const handlePrivacy = () => {
    const url = PRIVACY_URL?.trim();
    if (url) {
      Linking.openURL(url);
    } else {
      navigation.navigate('LegalDocument', { document: 'privacy', returnTo: 'Settings' });
    }
  };

  const handleAccessibility = () => {
    navigation.navigate('LegalDocument', { document: 'accessibility', returnTo: 'Settings' });
  };

  const handleLinkStaffProfile = useCallback(() => {
    if (!token) {
      Alert.alert(t('admin.error'), t('settings.notLoggedIn'));
      return;
    }
    if (linkingStaffInFlightRef.current) return;
    linkingStaffInFlightRef.current = true;
    setLinkingStaffProfile(true);
    void (async () => {
      try {
        const res = await linkMyStaffProfile(token);
        await fetchCurrentUser();
        const linkedNow = authUserHasStaffRow(getAuthState().user);
        if (linkedNow) {
          navigation.navigate('StaffDashboard');
        }
        const baseMsg = res.alreadyLinked ? t('admin.linkStaffProfileOkAlready') : t('admin.linkStaffProfileOk');
        const parts = [baseMsg];
        if (linkedNow) {
          parts.push(t('admin.linkStaffProfileNextSteps'));
        }
        Alert.alert(t('admin.success'), parts.join('\n\n'));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert(t('admin.error'), formatLinkMyStaffProfileError(msg, t));
      } finally {
        linkingStaffInFlightRef.current = false;
        setLinkingStaffProfile(false);
      }
    })();
  }, [token, fetchCurrentUser, t, navigation]);

  const handleDeleteAccount = useCallback(() => {
    if (deletingAccountInFlightRef.current) return;
    Alert.alert(
      t('settings.deleteAccountTitle'),
      t('settings.deleteAccountMsg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.deleteAccountConfirmCta'),
          style: 'destructive',
          onPress: () => {
            if (deletingAccountInFlightRef.current) return;
            deletingAccountInFlightRef.current = true;
            setDeletingAccount(true);
            void (async () => {
              try {
                const res = await deleteAccount();
                if (!res.success) {
                  Alert.alert(t('common.error'), res.error || t('settings.deleteAccountError'));
                  return;
                }
                navigation.navigate('Home');
                Alert.alert(t('common.ok'), t('settings.deleteAccountSuccess'));
              } finally {
                deletingAccountInFlightRef.current = false;
                setDeletingAccount(false);
              }
            })();
          },
        },
      ],
    );
  }, [deleteAccount, navigation, t]);

  const handleUnlinkStaffProfile = useCallback(() => {
    if (!token) {
      Alert.alert(t('admin.error'), t('settings.notLoggedIn'));
      return;
    }
    if (unlinkingStaffInFlightRef.current) return;
    Alert.alert(
      t('settings.staffProfileUnlinkConfirmTitle'),
      t('settings.staffProfileUnlinkConfirmMsg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.staffProfileUnlinkCta'),
          style: 'destructive',
          onPress: () => {
            if (unlinkingStaffInFlightRef.current) return;
            unlinkingStaffInFlightRef.current = true;
            setUnlinkingStaffProfile(true);
            void (async () => {
              try {
                const justUnlinkedStaffId = user?.staffId ?? null;
                await unlinkMyStaffProfile(token);
                // Immediate client-side purge before auth refresh returns:
                // prevents stale barber rows from lingering in Team/Booking.
                if (justUnlinkedStaffId) {
                  removeStaffFromTeamCache(justUnlinkedStaffId);
                }
                clearCustomerPrefetchCaches();
                clearStaffSessionCaches();
                clearAdminPrefetchCaches();
                clearAdminDashboardCache(token);
                await fetchCurrentUser();
                // Warm fresh customer staff list immediately after role change (without waiting for screen focus).
                void prefetchCustomerTabData(token);
                Alert.alert(t('admin.success'), t('settings.staffProfileUnlinkOk'));
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                Alert.alert(t('admin.error'), formatUnlinkMyStaffProfileError(msg, t));
              } finally {
                unlinkingStaffInFlightRef.current = false;
                setUnlinkingStaffProfile(false);
              }
            })();
          },
        },
      ],
    );
  }, [token, fetchCurrentUser, t]);

  const handleToggleNotifications = useCallback(
    (next: boolean) => {
      void setNotificationsEnabled(next, token).then(() => {
        if (next && token) {
          void forceNotificationsRefresh(token);
        }
      });
    },
    [setNotificationsEnabled, token, forceNotificationsRefresh]
  );

  return (
    <Screen style={styles.wrapper} noPadding>
      <BlackHeader
        title={t('settings.title')}
        onBackPress={() => navigation.navigate('Home')}
        onMenuPress={() => openDrawer(navigation)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[presets.scrollContent, styles.scrollBottom]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
          <PageIntro title={t('settings.pageTitle')} compact />

        <ShelfStaggerEnter index={0}>
        <View style={styles.profileCard}>
          <View style={styles.avatarRing}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={26} color={colors.accent} />
            </View>
          </View>
          <Text style={styles.userName}>{displayName}</Text>
          {isLoggedIn ? (
            <AppButton title={t('settings.logout')} onPress={handleLogout} variant="secondary" style={styles.logoutBtn} />
          ) : null}
        </View>
        </ShelfStaggerEnter>

        {isRestored && isLoggedIn ? (
          <ShelfStaggerEnter index={notificationsShelfIndex}>
            <Text style={styles.sectionHeading}>{t('settings.notificationsSection')}</Text>
            <View style={styles.notificationsCard}>
              <View style={styles.notificationsRow}>
                <View style={styles.notificationsTextCol}>
                  <Text style={styles.notificationsTitle}>{t('settings.notificationsToggleTitle')}</Text>
                  <Text style={styles.notificationsBody}>{t('settings.notificationsToggleBody')}</Text>
                </View>
                <Switch
                  value={notificationsEnabled}
                  onValueChange={handleToggleNotifications}
                  disabled={!notificationsPrefsReady}
                  trackColor={{ false: colors.border, true: colors.accent + '77' }}
                  thumbColor={notificationsEnabled ? colors.accent : colors.surface}
                  ios_backgroundColor={colors.border}
                />
              </View>
            </View>
          </ShelfStaggerEnter>
        ) : null}

        {showLinkStaffProfile || showUnlinkStaffProfile ? (
          <ShelfStaggerEnter index={staffLinkShelfIndex}>
            <Text style={styles.sectionHeading}>{t('settings.staffProfileLinkSection')}</Text>
            {showLinkStaffProfile ? (
              <View style={styles.staffLinkCard} collapsable={false}>
                <Text style={styles.staffLinkBody}>{t('admin.linkStaffProfileBannerBody')}</Text>
                <AppButton
                  title={linkingStaffProfile ? t('admin.linkStaffProfileBusy') : t('admin.linkStaffProfileCta')}
                  onPress={handleLinkStaffProfile}
                  variant="primary"
                  disabled={linkingStaffProfile}
                  loading={linkingStaffProfile}
                  style={styles.staffLinkBtn}
                />
              </View>
            ) : null}
            {showUnlinkStaffProfile ? (
              <View style={styles.staffUnlinkCard} collapsable={false}>
                <Text style={styles.staffUnlinkBody}>{t('settings.staffProfileUnlinkBody')}</Text>
                <AppButton
                  title={unlinkingStaffProfile ? t('settings.staffProfileUnlinkBusy') : t('settings.staffProfileUnlinkCta')}
                  onPress={handleUnlinkStaffProfile}
                  variant="secondary"
                  disabled={unlinkingStaffProfile}
                  loading={unlinkingStaffProfile}
                  style={styles.staffUnlinkBtn}
                />
              </View>
            ) : null}
          </ShelfStaggerEnter>
        ) : null}

        <ShelfStaggerEnter index={generalShelfIndex}>
        <Text style={styles.sectionHeading}>{t('settings.general')}</Text>
        <View style={styles.menuCard}>
          <Pressable style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]} onPress={handleTerms}>
            <View style={styles.menuIconWrap}>
              <Ionicons name="document-text-outline" size={iconSize.lg} color={colors.accent} />
            </View>
            <Text style={styles.menuLabel}>{t('settings.terms')}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </Pressable>
          <View style={styles.menuDivider} />
          <Pressable style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]} onPress={handlePrivacy}>
            <View style={styles.menuIconWrap}>
              <Ionicons name="shield-checkmark-outline" size={iconSize.lg} color={colors.accent} />
            </View>
            <Text style={styles.menuLabel}>{t('settings.privacy')}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </Pressable>
          <View style={styles.menuDivider} />
          <Pressable
            style={({ pressed }) => [
              styles.menuRow,
              !(isRestored && isLoggedIn) && styles.menuRowLast,
              pressed && styles.menuRowPressed,
            ]}
            onPress={handleAccessibility}
          >
            <View style={styles.menuIconWrap}>
              <Ionicons name="accessibility-outline" size={iconSize.lg} color={colors.accent} />
            </View>
            <Text style={styles.menuLabel}>{t('settings.accessibility')}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </Pressable>
          {isRestored && isLoggedIn ? (
            <>
              <View style={styles.menuDivider} />
              <Pressable
                style={({ pressed }) => [styles.menuRow, styles.menuRowLast, pressed && styles.menuRowPressed]}
                onPress={handleDeleteAccount}
              >
                <View style={[styles.menuIconWrap, styles.menuIconWrapDanger]}>
                  <Ionicons name="person-remove-outline" size={iconSize.lg} color={colors.danger} />
                </View>
                <Text style={[styles.menuLabel, styles.menuLabelDanger]}>
                  {deletingAccount ? t('settings.deleteAccountBusy') : t('settings.deleteAccount')}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
              </Pressable>
            </>
          ) : null}
        </View>
        </ShelfStaggerEnter>
        </ScreenEnter>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollBottom: {
    paddingBottom: spacing.xl,
  },
  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm + 2,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderTopWidth: 1,
    ...shadows.card,
    marginBottom: spacing.md,
  },
  avatarRing: {
    padding: 1,
    borderRadius: 34,
    backgroundColor: colors.accent + '22',
    marginBottom: spacing.xs,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  userName: {
    ...textStyles.pageTitle,
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  logoutBtn: {
    alignSelf: 'center',
    marginTop: 2,
    minHeight: 38,
    minWidth: 160,
    paddingHorizontal: spacing.md,
  },
  sectionHeading: {
    ...textStyles.sectionTitle,
    alignSelf: 'stretch',
    marginBottom: spacing.xs + 2,
    marginTop: 2,
    fontSize: 17,
  },
  notificationsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    ...shadows.card,
    marginBottom: spacing.sm,
  },
  notificationsRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  notificationsTextCol: {
    flex: 1,
    alignItems: 'flex-end',
  },
  notificationsTitle: {
    ...textStyles.body,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  notificationsBody: {
    ...textStyles.caption,
    color: colors.textSecondary,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 2,
  },
  menuCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
    ...shadows.card,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  menuRowLast: {
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  menuRowPressed: {
    backgroundColor: colors.surfaceMuted + 'AA',
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.accent + '18',
    justifyContent: 'center',
    alignItems: 'center',
    marginEnd: spacing.sm + 2,
  },
  menuIconWrapDanger: {
    backgroundColor: colors.danger + '14',
  },
  menuLabel: {
    flex: 1,
    ...textStyles.body,
    fontSize: 15,
    textAlign: 'right',
    marginEnd: spacing.sm,
  },
  menuLabelDanger: {
    color: colors.danger,
    fontWeight: '600',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md,
  },
  staffLinkCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    borderStartWidth: 2,
    borderStartColor: colors.accent,
    ...shadows.card,
  },
  staffLinkBody: {
    ...textStyles.bodySmall,
    color: colors.textSecondary,
    textAlign: 'right',
    marginBottom: spacing.sm,
    writingDirection: 'rtl',
  },
  staffLinkBtn: {
    alignSelf: 'stretch',
    minHeight: 44,
  },
  staffUnlinkCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    borderStartWidth: 2,
    borderStartColor: colors.danger + 'AA',
    ...shadows.card,
    marginTop: spacing.xs,
  },
  staffUnlinkBody: {
    ...textStyles.bodySmall,
    color: colors.textSecondary,
    textAlign: 'right',
    marginBottom: spacing.sm,
    writingDirection: 'rtl',
  },
  staffUnlinkBtn: {
    alignSelf: 'stretch',
    minHeight: 44,
  },
});
