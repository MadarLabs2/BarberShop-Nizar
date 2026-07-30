import { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { EmptyState } from '../../components/feedback/EmptyState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Keyed } from '../../components/ui/Keyed';
import { useAuth } from '../../hooks/useAuth';
import { useAdminCustomers, prefetchAdminCustomerDetails } from '../../hooks/useAdminCustomers';
import { formatPhoneDisplay } from '../../utils/phone';
import { openDrawer } from '../../utils/nav';
import { colors, spacing, radius, shadows, textStyles, iconSize, layout } from '../../theme';
import { canAccessAdmin } from '../../lib/navigation.roles';
import { formatDateDmy } from '../../utils/dates';
import type { AdminCustomerListItem } from '../../services/admin.api';

function formatLastAt(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatDateDmy(d);
}

function CustomerRow({
  item,
  onPress,
  onPressIn,
}: {
  item: AdminCustomerListItem;
  onPress: () => void;
  onPressIn?: () => void;
}) {
  const { t } = useTranslation();
  const phone = formatPhoneDisplay(item.phone);
  const subParts: string[] = [];
  if (item.totalAppointments > 0) subParts.push(t('admin.customerApptTotal', { count: item.totalAppointments }));
  if (item.upcomingAppointments > 0) subParts.push(t('admin.customerApptUpcoming', { count: item.upcomingAppointments }));
  const last = formatLastAt(item.lastAppointmentAt);
  if (last) subParts.push(t('admin.customerLastAppt', { date: last }));
  const sub = subParts.join(' · ');

  return (
    <TouchableOpacity style={styles.card} onPressIn={onPressIn} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardIcon}>
        <Ionicons name="person-outline" size={iconSize.lg} color={colors.accent} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.fullName?.trim() || t('admin.customerFallback')}
        </Text>
        {phone ? <Text style={styles.cardPhone}>{phone}</Text> : null}
        {sub ? (
          <Text style={styles.cardMeta} numberOfLines={2}>
            {sub}
          </Text>
        ) : (
          <Text style={styles.cardMeta}>{t('admin.noApptHistory')}</Text>
        )}
      </View>
      <Ionicons name="chevron-back" size={iconSize.md} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

export function AdminCustomersScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{
    navigate: (
      name: string,
      params?: { customerId: string; initialSummary?: AdminCustomerListItem },
    ) => void;
    openDrawer?: () => void;
  }>();
  const { token, role, hasStaffProfile } = useAuth();
  const c = useAdminCustomers(token);

  useEffect(() => {
    if (!token || !canAccessAdmin(role)) {
      (navigation.navigate as (name: string) => void)(hasStaffProfile ? 'StaffDashboard' : 'Home');
    }
  }, [token, role, hasStaffProfile, navigation]);

  useEffect(() => {
    if (!token || c.items.length === 0) return;
    // Warm top rows so details screen can render recent appointments instantly.
    const timers = c.items.slice(0, 8).map((item, idx) =>
      setTimeout(() => prefetchAdminCustomerDetails(token, item.id), idx * 110)
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [token, c.items]);

  if (!token || !canAccessAdmin(role)) {
    return null;
  }

  const showFullScreenLoader = c.loading && c.items.length === 0 && !c.refreshing;

  return (
    <Screen style={styles.screen} noPadding>
      <BlackHeader
        title={t('admin.customersTitle')}
        onBackPress={() => navigation.navigate('Dashboard')}
        onMenuPress={() => openDrawer(navigation)}
      />

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={iconSize.md} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('admin.searchPh')}
          placeholderTextColor={colors.textMuted}
          value={c.search}
          onChangeText={c.setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {showFullScreenLoader ? (
        <ScreenEnter replayOnFocus variant="rise" style={{ flex: 1 }}>
          <LoadingState />
        </ScreenEnter>
      ) : c.error && c.items.length === 0 ? (
        <ScreenEnter replayOnFocus variant="rise" style={{ flex: 1 }}>
          <EmptyState message={c.error} icon="alert-circle-outline" />
        </ScreenEnter>
      ) : (
        <FlatList
          data={c.items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={c.refreshing} onRefresh={c.refresh} />}
          onEndReached={() => c.loadMore()}
          onEndReachedThreshold={0.35}
          ListFooterComponent={
            c.loadingMore ? (
              <View style={styles.listFooter}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState title={t('admin.customersEmptyTitle')} message={t('admin.customersEmptyMsg')} icon="people-outline" />
          }
          renderItem={({ item }) => (
            <Keyed key={item.id}>
              <CustomerRow
                item={item}
                onPressIn={() => prefetchAdminCustomerDetails(token, item.id)}
                onPress={() => {
                  prefetchAdminCustomerDetails(token, item.id);
                  navigation.navigate('AdminCustomerDetails', { customerId: item.id, initialSummary: item });
                }}
              />
            </Keyed>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  searchWrap: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: layout.screenPaddingH,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.md,
    ...textStyles.body,
    textAlign: 'right',
  },
  listContent: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: spacing.xl * 2,
    gap: spacing.sm,
  },
  listFooter: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { ...textStyles.bodyMedium, textAlign: 'right' },
  cardPhone: { ...textStyles.bodySmall, marginTop: spacing.xs, textAlign: 'right' },
  cardMeta: { ...textStyles.bodySmall, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'right' },
});
