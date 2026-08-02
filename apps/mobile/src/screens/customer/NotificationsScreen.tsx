import { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  type ListRenderItemInfo,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { PageIntro } from '../../components/ui/PageIntro';
import { EmptyState } from '../../components/feedback/EmptyState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { ShelfStaggerEnter } from '../../components/ui/ShelfStaggerEnter';
import type { NotificationDto } from '../../services/notifications.api';
import { useAuth } from '../../hooks/useAuth';
import { useNotifications } from '../../contexts/NotificationsContext';
import { useBadgeSeen } from '../../contexts/BadgeSeenContext';
import { openDrawer } from '../../utils/nav';
import { formatDateDmy } from '../../utils/dates';
import { colors, spacing, presets, textStyles, layout, radius, shadows, iconSize } from '../../theme';

function formatNotificationTime(createdAt: string, tr: TFunction): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return tr('time.now');
  if (diffMins < 60) return tr('time.minsAgo', { count: diffMins });
  if (diffHours < 24) return tr('time.hoursAgo', { count: diffHours });
  if (diffDays < 7) return tr('time.daysAgo', { count: diffDays });
  return formatDateDmy(d);
}

function isCancelledNotif(title: string): boolean {
  const lower = title?.toLowerCase() ?? '';
  return (
    title?.includes('ביטלת') ||
    title?.includes('בוטל') ||
    title?.includes('ألغ') ||
    title?.includes('ملغ') ||
    lower.includes('cancel')
  );
}

function getIcon(type: string, title: string): keyof typeof Ionicons.glyphMap {
  if (type === 'admin') return 'megaphone';
  if (isCancelledNotif(title)) return 'close-circle';
  return 'checkmark-circle';
}

function getIconColor(type: string, title: string): string {
  if (type === 'admin') return colors.accentOrange;
  if (isCancelledNotif(title)) return colors.danger;
  return colors.success;
}

function NotificationCard({ n, timeLabel, listIndex }: { n: NotificationDto; timeLabel: string; listIndex: number }) {
  const iconColor = getIconColor(n.type, n.title);
  return (
    <ShelfStaggerEnter index={listIndex} style={[styles.card, { borderStartColor: iconColor }]}>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {n.title}
        </Text>
        {n.body ? (
          <Text style={styles.cardBodyText} numberOfLines={4}>
            {n.body}
          </Text>
        ) : null}
        <Text style={styles.cardTime}>{timeLabel}</Text>
      </View>
      <View style={[styles.iconWrap, { backgroundColor: iconColor + '22' }]}>
        <Ionicons name={getIcon(n.type, n.title)} size={22} color={iconColor} />
      </View>
    </ShelfStaggerEnter>
  );
}

export function NotificationsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const { token, isLoggedIn } = useAuth();
  const {
    items: notifications,
    error,
    deleting,
    refresh,
    forceRefresh,
    deleteAll,
    hasLoadedOnce,
  } = useNotifications();
  const { markNotificationsSeenFromItems } = useBadgeSeen();
  /** Drives the FlatList's pull-to-refresh spinner only — a user-initiated pull gesture.
   * Deliberately NOT the context's background `refreshing` flag: a silent focus-triggered
   * background refetch must never pop the native pull spinner (that read as an unwanted
   * "reload") — only an actual pull-down by the user should ever show it. */
  const [pulling, setPulling] = useState(false);
  const focusEnter = useSharedValue(1);

  const focusEnterStyle = useAnimatedStyle(() => ({
    opacity: 0.9 + focusEnter.value * 0.1,
    transform: [{ translateY: (1 - focusEnter.value) * 10 }],
  }));

  const markSeenRef = useRef(markNotificationsSeenFromItems);
  markSeenRef.current = markNotificationsSeenFromItems;

  const timeFor = useCallback(
    (createdAt: string) => formatNotificationTime(createdAt, t),
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      focusEnter.value = 0;
      focusEnter.value = withTiming(1, { duration: 220 });
      void (async () => {
        if (!token) return;
        // `refresh(..., { forceNetwork: true })` keeps its normal cache-first instant paint (peek,
        // then disk) so the screen never sits blank while waiting on the server — but unlike a
        // plain `refresh()`, it never skips the network call just because the last fetch was under
        // the 20s staleness window (e.g. right after Home's on-mount background sync), so a
        // notification created in between still shows up without a manual pull. `forceRefresh`
        // (used only by pull-to-refresh) has no cache step at all — using it here is what caused
        // the screen to render empty/loading for a few seconds before content appeared.
        const items = await refresh(token, { forceNetwork: true });
        if (cancelled || items === null) return;
        await markSeenRef.current(items);
      })();
      return () => {
        cancelled = true;
      };
    }, [token, refresh, focusEnter]),
  );

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      const items = await forceRefresh(token);
      if (items) await markNotificationsSeenFromItems(items);
    } finally {
      setPulling(false);
    }
  }, [token, forceRefresh, markNotificationsSeenFromItems]);

  const handleDeleteAll = useCallback(() => {
    if (!token || deleting) return;
    Alert.alert(
      t('notifications.clearTitle'),
      t('notifications.clearMsg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('notifications.clearAll'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAll(token);
              await markNotificationsSeenFromItems([]);
            } catch (e) {
              Alert.alert(
                t('common.error'),
                e instanceof Error ? e.message : t('notifications.clearFailed'),
              );
            }
          },
        },
      ],
    );
  }, [token, deleting, deleteAll, markNotificationsSeenFromItems, t]);

  const notificationsHero = useMemo(
    () => <PageIntro compact title={t('notifications.centerTitle')} />,
    [t],
  );

  const emptyComponent = useMemo(
    () => (
      <EmptyState
        title={t('notifications.emptyTitle')}
        message={t('notifications.emptyMsg')}
        icon="notifications-off-outline"
      />
    ),
    [t],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<NotificationDto>) => (
      <NotificationCard n={item} timeLabel={timeFor(item.created_at)} listIndex={index} />
    ),
    [timeFor],
  );

  const header = (
    <BlackHeader
      title={t('screenTitles.Notifications')}
      onBackPress={() => navigation.navigate('Home')}
      onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
    />
  );

  if (!isLoggedIn || !token) {
    return (
      <Screen noPadding>
        {header}
        <ScrollView contentContainerStyle={[presets.scrollContent, styles.emptyListScroll]}>
          <ScreenEnter variant="rise" style={styles.enterGrow}>
            <Animated.View style={[styles.enterGrow, focusEnterStyle]}>
              {notificationsHero}
              <EmptyState
                title={t('appointments.needLoginTitle')}
                message={t('notifications.needLoginMsg')}
                icon="lock-closed-outline"
              />
            </Animated.View>
          </ScreenEnter>
        </ScrollView>
      </Screen>
    );
  }

  // True first load only — never re-enters this branch afterwards (`hasLoadedOnce` only resets on
  // logout/token change, a legitimately different session, not a background refetch or delete-all).
  if (!hasLoadedOnce && notifications.length === 0 && !error) {
    return (
      <Screen noPadding>
        {header}
        <ScreenEnter variant="rise" style={styles.enterFlex}>
          <Animated.View style={[styles.enterFlex, focusEnterStyle]}>
            <LoadingState />
          </Animated.View>
        </ScreenEnter>
      </Screen>
    );
  }

  if (error && notifications.length === 0) {
    return (
      <Screen noPadding>
        {header}
        <ScrollView contentContainerStyle={[presets.scrollContent, styles.emptyListScroll]}>
          <ScreenEnter variant="rise" style={styles.enterGrow}>
            <Animated.View style={[styles.enterGrow, focusEnterStyle]}>
              {notificationsHero}
              <EmptyState title={t('notifications.errorTitle')} message={error} icon="alert-circle-outline" />
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={async () => {
                  const items = await forceRefresh(token);
                  if (items) await markNotificationsSeenFromItems(items);
                }}
              >
                <Text style={styles.retryText}>{t('common.tryAgain')}</Text>
              </TouchableOpacity>
            </Animated.View>
          </ScreenEnter>
        </ScrollView>
      </Screen>
    );
  }

  // Steady state — one persistent tree from here on. Whether the list has items or is empty
  // (including right after a delete-all), the SAME FlatList stays mounted: only its content
  // changes, never the surrounding header/animation, so nothing can visibly "remount" or flash.
  const showClearBar = notifications.length > 0;

  return (
    <Screen noPadding>
      {header}
      {showClearBar ? (
        <View style={styles.clearBar}>
          <TouchableOpacity
            onPress={handleDeleteAll}
            disabled={deleting}
            style={styles.clearBarBtn}
            accessibilityRole="button"
            accessibilityLabel={t('notifications.clearA11y')}
          >
            <Text style={[styles.clearBarText, deleting && styles.clearBarTextDisabled]}>
              {t('notifications.clearAll')}
            </Text>
            <Ionicons name="trash-outline" size={iconSize.sm} color={deleting ? colors.textMuted : colors.danger} />
          </TouchableOpacity>
        </View>
      ) : null}
      <ScreenEnter variant="rise" style={styles.enterFlex}>
        <Animated.View style={[styles.enterFlex, focusEnterStyle]}>
          <FlatList
            style={styles.enterFlex}
            data={notifications}
            keyExtractor={(n) => n.id}
            renderItem={renderItem}
            ListHeaderComponent={notificationsHero}
            ListEmptyComponent={emptyComponent}
            contentContainerStyle={[
              presets.scrollContent,
              notifications.length === 0 ? styles.emptyListScroll : styles.scrollContentTop,
            ]}
            refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} />}
            initialNumToRender={12}
            maxToRenderPerBatch={16}
            windowSize={8}
          />
        </Animated.View>
      </ScreenEnter>
    </Screen>
  );
}

const styles = StyleSheet.create({
  enterFlex: { flex: 1 },
  enterGrow: { flexGrow: 1 },
  emptyListScroll: {
    flexGrow: 1,
    justifyContent: 'flex-start',
  },
  scrollContentTop: {},
  clearBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
  },
  clearBarBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  clearBarText: {
    ...textStyles.bodySmall,
    color: colors.danger,
    fontWeight: '600',
  },
  clearBarTextDisabled: { opacity: 0.45 },
  /** RTL: text first (right), icon left; thick accent on borderStart (visual right) */
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 15,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderStartWidth: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...shadows.card,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: {
    ...textStyles.bodyMedium,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
    textAlign: 'right',
  },
  cardBodyText: {
    ...textStyles.bodySmall,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textAlign: 'right',
  },
  cardTime: {
    ...textStyles.caption,
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'right',
  },
  retryBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
  },
  retryText: {
    color: colors.onPrimary,
    fontWeight: '600',
  },
});
