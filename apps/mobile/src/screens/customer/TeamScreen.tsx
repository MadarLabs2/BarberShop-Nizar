import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { PageIntro } from '../../components/ui/PageIntro';
import { EmptyState } from '../../components/feedback/EmptyState';
import { Keyed } from '../../components/ui/Keyed';
import { AppButton } from '../../components/ui/AppButton';
import type { CatalogStaffMember } from '../../services/bookings.api';
import {
  peekTeamStaff,
  prefetchCustomerTabData,
  ensureBookableStaffList,
  prefetchStaffBookingContexts,
  revalidateBookableStaffList,
  syncCustomerPrefetchToken,
  subscribeTeamStaffList,
} from '../../services/customerPrefetchCache';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { openDrawer } from '../../utils/nav';
import { formatPhoneDisplay, toE164 } from '../../utils/phone';
import type { RootDrawerParamList } from '../../navigation/paramList';
import { colors, spacing, typography, radius, shadows, presets, textStyles, iconSize } from '../../theme';
import { TEAM_SCREEN_ENTER_MS, TEAM_SCREEN_ENTER_RISE_FROM_Y } from '../../theme/motion';

function taglineFor(member: CatalogStaffMember, index: number, tr: (k: string) => string): string {
  const taglines = [tr('team.tagline0'), tr('team.tagline1'), tr('team.tagline2')];
  let h = 0;
  for (let i = 0; i < member.id.length; i++) h = (h + member.id.charCodeAt(i)) % taglines.length;
  return taglines[(h + index) % taglines.length];
}

/** Apply cached staff + stop spinner (shared by layout + focus so we never wait an extra frame for focus). */
function applyCachedTeam(
  setStaff: (list: CatalogStaffMember[]) => void,
  setLoading: (v: boolean) => void,
  cached: CatalogStaffMember[],
) {
  setStaff(cached);
  setLoading(false);
  void prefetchStaffBookingContexts(cached.map((s) => s.id));
}

export function TeamScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<DrawerNavigationProp<RootDrawerParamList>>();
  const { token, isLoggedIn } = useAuth();
  const [staff, setStaff] = useState<CatalogStaffMember[]>(() => peekTeamStaff() ?? []);
  const [loading, setLoading] = useState(() => peekTeamStaff() === null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Instant refresh when prefetch / admin updates the shared team cache. */
  useEffect(() => {
    return subscribeTeamStaffList((list) => {
      if (!mounted.current) return;
      setStaff(list);
      setLoading(false);
    });
  }, []);

  /**
   * Before first paint: re-peek team cache (may have filled between app init and this mount).
   * Avoids showing a spinner when prefetch already completed (focus runs after paint).
   */
  useLayoutEffect(() => {
    if (token) syncCustomerPrefetchToken(token);
    const cached = peekTeamStaff();
    if (cached !== null) {
      applyCachedTeam(setStaff, setLoading, cached);
      return;
    }
    if (token) void prefetchCustomerTabData(token);
  }, [token]);

  const hydrateTeam = useCallback(() => {
    if (token) syncCustomerPrefetchToken(token);
    const cached = peekTeamStaff();
    if (cached !== null) {
      applyCachedTeam(setStaff, setLoading, cached);
    } else {
      setLoading(true);
      void ensureBookableStaffList()
        .then((list) => {
          if (mounted.current) setStaff(list);
        })
        .catch(() => {
          const fallback = peekTeamStaff();
          if (mounted.current && fallback !== null) setStaff(fallback);
        })
        .finally(() => {
          if (mounted.current) setLoading(false);
        });
    }
    if (token) void prefetchCustomerTabData(token);
    /** Fresh list from API — `subscribeTeamStaffList` updates UI when cache replaces (deleted staff drops off). */
    void revalidateBookableStaffList().catch(() => undefined);
  }, [token]);

  useFocusEffect(useCallback(() => {
    hydrateTeam();
  }, [hydrateTeam]));

  const openCall = (phone: string | null) => {
    if (!phone) return;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9) return;
    Linking.openURL(`tel:${toE164(phone)}`);
  };

  const goToBookingOrLogin = (bookingParams?: { initialStaffId?: string }) => {
    if (!token || !isLoggedIn) {
      navigation.navigate('Login');
      return;
    }
    navigation.navigate('Booking', bookingParams ?? {});
  };

  const goBookWithStaff = (memberId: string) => {
    goToBookingOrLogin({ initialStaffId: memberId });
  };

  return (
    <Screen style={styles.screen} noPadding>
      <BlackHeader
        title={t('screenTitles.Team')}
        onBackPress={() => navigation.navigate('Home')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      {loading && staff.length === 0 ? (
        <ScreenEnter
          replayOnFocus
          variant="rise"
          durationMs={TEAM_SCREEN_ENTER_MS}
          riseFromY={TEAM_SCREEN_ENTER_RISE_FROM_Y}
          style={{ flex: 1 }}
        >
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingHint}>{t('team.loading')}</Text>
            <View style={[styles.ctaBlock, styles.ctaBlockOnLoading]}>
              <AppButton
                title={t('team.ctaBookTeam')}
                onPress={() => goToBookingOrLogin()}
                variant="secondary"
                style={styles.ctaButton}
              />
            </View>
          </View>
        </ScreenEnter>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[presets.scrollContent, styles.scrollContent]}
          showsVerticalScrollIndicator={false}
        >
          <ScreenEnter
            replayOnFocus
            variant="rise"
            durationMs={TEAM_SCREEN_ENTER_MS}
            riseFromY={TEAM_SCREEN_ENTER_RISE_FROM_Y}
            style={{ flexGrow: 1 }}
          >
            <PageIntro compact title={t('team.pageTitle')} />

            {staff.length === 0 ? (
              <EmptyState title={t('team.emptyTitle')} message={t('team.emptyMsg')} icon="people-outline" />
            ) : (
              <View style={styles.grid}>
                {staff.map((member, index) => (
                  <Keyed key={member.id}>
                    <TouchableOpacity
                      style={[styles.card, shadows.card]}
                      onPress={() => goBookWithStaff(member.id)}
                      activeOpacity={0.82}
                      accessibilityRole="button"
                      accessibilityLabel={t('team.bookA11y', { name: member.name })}
                    >
                      <View style={styles.cardInner}>
                        <View style={styles.avatarRing}>
          {member.avatarUrl ? (
            <ExpoImage
              recyclingKey={member.id}
              source={{ uri: member.avatarUrl }}
              style={styles.avatarImg}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={0}
            />
                          ) : (
                            <View style={styles.avatarPlaceholder}>
                              <Ionicons name="person" size={28} color={colors.accent} />
                            </View>
                          )}
                        </View>
                        <View style={styles.cardText}>
                          <Text style={styles.memberName} numberOfLines={2}>
                            {member.name}
                          </Text>
                          <Text style={styles.memberTagline} numberOfLines={1}>
                            {taglineFor(member, index, t)}
                          </Text>
                          {member.phone ? (
                            <TouchableOpacity
                              style={styles.phoneRow}
                              onPress={() => openCall(member.phone)}
                              activeOpacity={0.75}
                              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                            >
                              <Ionicons name="call-outline" size={iconSize.sm} color={colors.accent} />
                              <Text style={styles.phoneText}>{formatPhoneDisplay(member.phone)}</Text>
                            </TouchableOpacity>
                          ) : null}
                          <View style={styles.cardCtaHint}>
                            <Text style={styles.ctaHintText}>{t('team.tapToBook')}</Text>
                            <Ionicons name="chevron-back" size={iconSize.sm} color={colors.textMuted} />
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </Keyed>
                ))}
              </View>
            )}

            <View style={styles.ctaBlock}>
              <AppButton
                title={t('team.ctaBookTeam')}
                onPress={() => goToBookingOrLogin()}
                variant="secondary"
                style={styles.ctaButton}
              />
            </View>
          </ScreenEnter>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  /** Mirrors admin `DashboardScreen` `mgmtContent` so scroll padding / motion match. */
  scrollContent: {
    paddingBottom: 100,
    backgroundColor: colors.background,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  ctaBlockOnLoading: {
    marginTop: spacing.lg,
    alignSelf: 'stretch',
    maxWidth: 400,
  },
  loadingHint: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  grid: { gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm + 2,
  },
  avatarRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: colors.accent + '99',
    padding: 2,
    backgroundColor: colors.background,
  },
  avatarImg: { width: '100%', height: '100%', borderRadius: 32 },
  avatarPlaceholder: {
    flex: 1,
    borderRadius: 32,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, minWidth: 0 },
  memberName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
    marginBottom: 2,
  },
  memberTagline: {
    ...textStyles.caption,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'right',
    marginBottom: spacing.xs,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    alignSelf: 'stretch',
    marginBottom: spacing.xs,
    paddingVertical: 2,
  },
  phoneText: {
    ...typography.bodySmall,
    color: colors.accent,
    fontWeight: '600',
    textAlign: 'right',
  },
  cardCtaHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 0,
  },
  ctaHintText: {
    ...textStyles.caption,
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  ctaBlock: { marginTop: spacing.md, marginBottom: spacing.sm },
  ctaButton: {
    paddingVertical: 12,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.accent + '55',
    backgroundColor: colors.surface,
  },
});
