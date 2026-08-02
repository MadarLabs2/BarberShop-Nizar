import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { PageIntro } from '../../components/ui/PageIntro';
import { ProfileMenuRow } from '../../components/profile/ProfileMenuRow';
import { ProfileQuickAction } from '../../components/profile/ProfileQuickAction';
import { useAuth } from '../../hooks/useAuth';
import { useAppointments } from '../../contexts/AppointmentsContext';
import { openDrawer } from '../../utils/nav';
import {
  BARBERSHOP_PHONE,
  BARBERSHOP_PHONE_INTL,
  TERMS_URL,
  PRIVACY_URL,
  buildWhatsAppChatUrl,
} from '../../lib/config';
import { toE164 } from '../../utils/phone';
import { useShopBranch } from '../../hooks/useShopBranch';
import type { RootDrawerParamList } from '../../navigation/paramList';
import { colors, spacing, radius, presets, textStyles, shadows, iconSize, layout } from '../../theme';
import { formatIsoDateDmy } from '../../utils/dates';

function formatBirthDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  try {
    return formatIsoDateDmy(iso);
  } catch {
    return null;
  }
}

function openLegal(
  navigation: DrawerNavigationProp<RootDrawerParamList>,
  kind: 'terms' | 'privacy',
  returnTo: 'Profile' | 'Settings',
) {
  const url = kind === 'terms' ? TERMS_URL : PRIVACY_URL;
  if (url?.trim()) {
    Linking.openURL(url.trim());
    return;
  }
  navigation.navigate('LegalDocument', { document: kind, returnTo });
}

export function ProfileScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<DrawerNavigationProp<RootDrawerParamList>>();
  const { user, isLoggedIn, logout } = useAuth();
  const { upcoming, past } = useAppointments();
  const upcomingCount = upcoming.length;
  const pastCount = past.length;
  const totalCount = upcomingCount + pastCount;
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const displayName = isLoggedIn && user
    ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || t('common.user')
    : t('common.guest');

  const birthLabel = user?.birthDate ? formatBirthDate(user.birthDate) : null;

  const handleLogout = () => {
    logout();
    navigation.navigate('Home');
  };

  const goAuthOr = (screen: 'Booking' | 'Appointments') => {
    if (!isLoggedIn) {
      navigation.navigate('Login');
      return;
    }
    if (screen === 'Booking') {
      navigation.navigate('Booking', {});
    } else {
      navigation.navigate('Appointments');
    }
  };

  /** Admin-editable shop phone — first active branch, kept in sync via customer prefetch cache. */
  const shopBranch = useShopBranch();

  const shopPhoneDisplay = shopBranch?.phone || BARBERSHOP_PHONE;

  const openWhatsApp = () => {
    Linking.openURL(buildWhatsAppChatUrl(shopBranch?.phone)).catch(() => {
      Alert.alert(t('common.error'), t('profile.waOpenError'));
    });
  };

  const openDialer = () => {
    const tel = `tel:${shopBranch?.phone ? toE164(shopBranch.phone) : BARBERSHOP_PHONE_INTL.replace(/\s/g, '')}`;
    Linking.openURL(tel).catch(() => {});
  };

  return (
    <Screen style={styles.wrapper} noPadding>
      <BlackHeader
        title={t('screenTitles.Profile')}
        onBackPress={() => navigation.navigate('Home')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={presets.scrollContent} showsVerticalScrollIndicator={false}>
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
        <PageIntro title={t('profile.introTitle')} />

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={iconSize.emptyState} color={colors.accent} />
          </View>
          <Text style={styles.userName}>{displayName}</Text>
          {isLoggedIn && user?.phone ? (
            <View style={styles.detailRow}>
              <Ionicons name="call-outline" size={iconSize.sm} color={colors.textSecondary} />
              <Text style={styles.detailText}>{t('profile.phoneLabel', { phone: user.phone })}</Text>
            </View>
          ) : (
            <Text style={styles.guestHint}>{t('profile.guestHint')}</Text>
          )}
          {isLoggedIn && birthLabel ? (
            <View style={styles.detailRow}>
              <Ionicons name="gift-outline" size={iconSize.sm} color={colors.textSecondary} />
              <Text style={styles.detailText}>{t('profile.birthLabel', { date: birthLabel })}</Text>
            </View>
          ) : null}
          {isLoggedIn ? (
            <Text style={styles.editHint}>{t('profile.editHint')}</Text>
          ) : null}
        </View>

        {isLoggedIn ? (
          <View style={styles.statsContainer}>
            <View style={styles.statCard}>
              <Ionicons name="calendar" size={iconSize.xl} color={colors.accent} />
              <Text style={styles.statNumber}>{upcomingCount}</Text>
              <Text style={styles.statLabel}>{t('profile.statUpcoming')}</Text>
            </View>
            <View style={styles.statCard}>
              <Ionicons name="checkmark-circle" size={iconSize.xl} color={colors.success} />
              <Text style={styles.statNumber}>{pastCount}</Text>
              <Text style={styles.statLabel}>{t('profile.statDone')}</Text>
            </View>
            <View style={styles.statCard}>
              <Ionicons name="list" size={iconSize.xl} color={colors.accent} />
              <Text style={styles.statNumber}>{totalCount}</Text>
              <Text style={styles.statLabel}>{t('profile.statTotal')}</Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>{t('profile.shortcuts')}</Text>
        <View style={styles.quickRow}>
          <ProfileQuickAction icon="calendar-outline" label={t('profile.quickAppointments')} onPress={() => goAuthOr('Appointments')} />
          <ProfileQuickAction icon="cut-outline" label={t('profile.quickBooking')} onPress={() => goAuthOr('Booking')} />
          <ProfileQuickAction icon="navigate-outline" label={t('profile.quickDirections')} onPress={() => navigation.navigate('Directions')} />
        </View>

        <TouchableOpacity style={styles.whatsappCard} onPress={openWhatsApp} activeOpacity={0.9}>
          <View style={styles.whatsappIconWrap}>
            <Ionicons name="logo-whatsapp" size={32} color="#fff" />
          </View>
          <View style={styles.whatsappTextWrap}>
            <Text style={styles.whatsappTitle}>{t('profile.waTitle')}</Text>
            <Text style={styles.whatsappSub}>{t('profile.waSub')}</Text>
            <Text style={styles.whatsappPhone}>{shopPhoneDisplay}</Text>
          </View>
          <Ionicons name="chevron-forward" size={iconSize.md} color={colors.textMuted} style={styles.whatsappChevron} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.phoneRow} onPress={openDialer} activeOpacity={0.85}>
          <Ionicons name="call" size={iconSize.lg} color={colors.accent} />
          <Text style={styles.phoneRowText}>{t('profile.dialQuick', { phone: shopPhoneDisplay })}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>{t('profile.accountSection')}</Text>
        <View style={styles.menuBlock}>
          <ProfileMenuRow icon="settings-outline" label={t('screenTitles.Settings')} onPress={() => navigation.navigate('Settings')} />
          <ProfileMenuRow
            icon="notifications-outline"
            label={t('profile.menuNotifications')}
            onPress={() => (isLoggedIn ? navigation.navigate('Notifications') : navigation.navigate('Login'))}
          />
          <ProfileMenuRow
            icon="document-text-outline"
            label={t('profile.menuTerms')}
            onPress={() => openLegal(navigation, 'terms', 'Profile')}
          />
          <ProfileMenuRow
            icon="shield-checkmark-outline"
            label={t('profile.menuPrivacy')}
            onPress={() => openLegal(navigation, 'privacy', 'Profile')}
          />
          <ProfileMenuRow
            icon="accessibility-outline"
            label={t('profile.menuAccessibility')}
            onPress={() => navigation.navigate('LegalDocument', { document: 'accessibility', returnTo: 'Profile' })}
          />
          <ProfileMenuRow
            icon="information-circle-outline"
            label={t('profile.menuAbout')}
            onPress={() => navigation.navigate('AboutApp', { returnTo: 'Profile' })}
          />
        </View>

        <View style={styles.footerMeta}>
          <Text style={styles.footerMetaText}>{t('profile.footerVersion', { version: appVersion })}</Text>
        </View>

        {isLoggedIn ? (
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={iconSize.lg} color={colors.danger} />
            <Text style={styles.logoutButtonText}>{t('profile.logout')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.loginCta} onPress={() => navigation.navigate('Login')} activeOpacity={0.85}>
            <Text style={styles.loginCtaText}>{t('profile.loginOrRegister')}</Text>
            <Ionicons name="arrow-back" size={iconSize.md} color={colors.onPrimary} />
          </TouchableOpacity>
        )}
        </ScreenEnter>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
    borderWidth: 3,
    borderColor: colors.accent + '55',
  },
  userName: {
    ...textStyles.pageTitle,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  detailText: {
    ...textStyles.bodySmall,
    color: colors.text,
  },
  guestHint: {
    ...textStyles.bodySmall,
    textAlign: 'center',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  editHint: {
    ...textStyles.caption,
    textAlign: 'center',
    color: colors.textTertiary,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    lineHeight: 18,
  },
  sectionLabel: {
    ...textStyles.label,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  quickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  whatsappCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#25D366' + '55',
    ...shadows.cardStrong,
  },
  whatsappIconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: '#25D366',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  whatsappTextWrap: {
    flex: 1,
    alignItems: 'flex-end',
  },
  whatsappChevron: { marginLeft: spacing.xs },
  whatsappTitle: {
    ...textStyles.bodyMedium,
    marginBottom: 2,
  },
  whatsappSub: {
    ...textStyles.caption,
    marginBottom: spacing.xs,
  },
  whatsappPhone: {
    ...textStyles.caption,
    fontWeight: '700',
    color: colors.accent,
  },
  phoneRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  phoneRowText: {
    ...textStyles.bodyMedium,
    color: colors.text,
  },
  menuBlock: {
    marginBottom: spacing.lg,
  },
  footerMeta: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  footerMetaText: {
    ...textStyles.caption,
    color: colors.textTertiary,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerMuted,
    marginTop: spacing.sm,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger + '44',
    gap: spacing.sm,
    minHeight: layout.hitMin,
  },
  logoutButtonText: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '700',
  },
  loginCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
    minHeight: layout.hitMin,
  },
  loginCtaText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  statsContainer: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.sm,
  },
  statLabel: {
    ...textStyles.caption,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
