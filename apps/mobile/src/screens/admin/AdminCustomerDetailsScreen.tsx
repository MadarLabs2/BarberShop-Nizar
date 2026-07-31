import { useState, useCallback, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { localizeCatalogString, useAppLocale, type AppLocale } from '../../contexts/LocaleContext';
import i18n from '../../i18n';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { AppButton } from '../../components/ui/AppButton';
import { EmptyState } from '../../components/feedback/EmptyState';
import { Keyed } from '../../components/ui/Keyed';
import { useAuth } from '../../hooks/useAuth';
import {
  queueAdminCustomersListMutation,
  getWarmAdminCustomerDetailsCached,
  setWarmAdminCustomerDetails,
  invalidateWarmAdminCustomerDetails,
  subscribeAdminCustomerWarmCache,
  getAdminCustomerWarmCacheEpoch,
} from '../../hooks/useAdminCustomers';
import {
  getAdminCustomerDetails,
  patchAdminCustomer,
  deleteAdminCustomer,
  deleteAdminCustomerAppointments,
  adminCustomerDetailsToListItem,
  type AdminCustomerDetails,
  type AdminCustomerRecentAppointment,
  type AdminCustomerListItem,
} from '../../services/admin.api';
import { formatPhoneDisplay } from '../../utils/phone';
import { formatAppointmentDate, formatIsoDateDmy, formatIsoDateTimeDmyHm } from '../../utils/dates';
import { validateName, validateStaffPhone, isValidDateString } from '../../utils/validators';
import { openDrawer } from '../../utils/nav';
import { colors, spacing, radius, shadows, presets, textStyles, iconSize } from '../../theme';
import { LoadingState } from '../../components/feedback/LoadingState';
import { canAccessAdmin } from '../../lib/navigation.roles';

type DetailsRoute = RouteProp<
  {
    AdminCustomerDetails: {
      customerId: string;
      initialSummary?: AdminCustomerListItem;
    };
  },
  'AdminCustomerDetails'
>;

function listItemToDetail(s: AdminCustomerListItem): AdminCustomerDetails {
  const fullName =
    (s.fullName ?? `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim()) || i18n.t('admin.customerFallback');
  return {
    id: s.id,
    firstName: s.firstName ?? '',
    lastName: s.lastName ?? '',
    fullName,
    phone: s.phone ?? '',
    birthDate: s.birthDate ?? null,
    createdAt: s.createdAt ?? null,
    totalAppointments: s.totalAppointments ?? 0,
    upcomingAppointments: s.upcomingAppointments ?? 0,
    cancelledAppointments: 0,
    lastAppointmentAt: s.lastAppointmentAt ?? null,
    recentAppointments: [],
  };
}

function mapPatchError(msg: string): string {
  if (msg.includes('PHONE_IN_USE')) return i18n.t('admin.errPhoneInUse');
  if (msg.includes('PHONE_BELONGS_TO_STAFF')) return i18n.t('admin.errPhoneStaff');
  if (msg.includes('שם פרטי')) return msg;
  if (msg.includes('שם משפחה')) return msg;
  return msg;
}

function formatBirth(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatIsoDateDmy(iso);
}

function formatRegistered(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatIsoDateTimeDmyHm(iso);
}

function formatLastAppointment(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatIsoDateTimeDmyHm(iso);
}

function appointmentDateTimeMs(a: AdminCustomerRecentAppointment): number {
  const hhmm = (a.time || '').slice(0, 5);
  const iso = `${a.date}T${hhmm.length === 5 ? `${hhmm}:00` : '00:00:00'}`;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function StatBox({
  icon,
  label,
  value,
  active = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable style={[styles.statBox, active && styles.statBoxActive]} onPress={onPress} disabled={!onPress}>
      <View style={[styles.statIconWrap, active && styles.statIconWrapActive]}>
        <Ionicons name={icon} size={iconSize.md} color={colors.accent} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function RecentCard({
  appointment: a,
  localeTag,
  locale,
}: {
  appointment: AdminCustomerRecentAppointment;
  localeTag: string;
  locale: AppLocale;
}) {
  const { t } = useTranslation();
  const when = formatAppointmentDate(a.date, a.time, localeTag);
  const statusLabel =
    a.status === 'confirmed'
      ? t('admin.statusConfirmed')
      : a.status === 'cancelled'
        ? t('admin.statusCancelled')
        : a.status === 'completed'
          ? t('admin.statusCompleted')
          : a.status;
  return (
    <View style={styles.aptCard}>
      <View style={styles.aptTop}>
        <Text style={styles.aptTime}>{a.time?.slice(0, 5)}</Text>
        <Text style={styles.aptStatus}>{statusLabel}</Text>
      </View>
      <Text style={styles.aptWhen}>{when}</Text>
      <Text style={styles.aptService} numberOfLines={1}>
        {localizeCatalogString(a.serviceName, locale) || t('admin.serviceFallback')}
      </Text>
      <Text style={styles.aptMeta} numberOfLines={2}>
        {[a.staffName, localizeCatalogString(a.branchName, locale)].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

export function AdminCustomerDetailsScreen() {
  const { t } = useTranslation();
  const { localeTag, locale } = useAppLocale();
  const navigation = useNavigation<{
    navigate: (name: string, params?: object) => void;
    openDrawer?: () => void;
  }>();
  const route = useRoute<DetailsRoute>();
  const insets = useSafeAreaInsets();
  const customerId = route.params?.customerId;
  const initialSummary = route.params?.initialSummary;
  const { token, role, hasStaffProfile } = useAuth();

  const fetchGenRef = useRef(0);

  const [detail, setDetail] = useState<AdminCustomerDetails | null>(() => {
    if (!customerId) return null;
    const cached = getWarmAdminCustomerDetailsCached(customerId);
    if (cached) return cached;
    const s = route.params?.initialSummary;
    if (s && s.id === customerId) return listItemToDetail(s);
    return null;
  });
  const [fetching, setFetching] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editBirth, setEditBirth] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingAppointments, setDeletingAppointments] = useState(false);
  const [appointmentsView, setAppointmentsView] = useState<'all' | 'closest'>('all');
  const [focusedField, setFocusedField] = useState<'first' | 'last' | 'phone' | 'birth' | null>(null);

  const warmEpoch = useSyncExternalStore(
    subscribeAdminCustomerWarmCache,
    getAdminCustomerWarmCacheEpoch,
    getAdminCustomerWarmCacheEpoch,
  );

  const fromList =
    initialSummary && customerId && initialSummary.id === customerId ? listItemToDetail(initialSummary) : null;

  /** Fresh peek (45s) or any cached prefetch/last-open — latter keeps UI instant after the peek window. */
  const warmCached = useMemo(() => {
    void warmEpoch;
    if (!customerId) return null;
    const w = getWarmAdminCustomerDetailsCached(customerId);
    return w && w.id === customerId ? w : null;
  }, [customerId, warmEpoch]);

  /**
   * Route + warm cache + state. Prefer warm over list bootstrap when warm has recent appointments
   * (prefetch may complete after bootstrap was written to state).
   * Ignore `detail` when it belongs to another customer (params can change before effects run).
   */
  const displayDetail: AdminCustomerDetails | null = useMemo(() => {
    const d = detail && detail.id === customerId ? detail : null;
    const w = warmCached && warmCached.id === customerId ? warmCached : null;
    if (d && w && d.id === w.id) {
      if (d.recentAppointments.length === 0 && w.recentAppointments.length > 0) return w;
      if (d.cancelledAppointments === 0 && w.cancelledAppointments > 0) return w;
    }
    return d ?? w ?? fromList;
  }, [customerId, detail, warmCached, fromList]);

  const closestUpcomingAppointment = useMemo(() => {
    const items = displayDetail?.recentAppointments ?? [];
    if (items.length === 0) return null;
    const now = Date.now();
    const upcoming = items
      .filter((a) => a.status === 'confirmed')
      .map((a) => ({ a, ms: appointmentDateTimeMs(a) }))
      .filter((x) => Number.isFinite(x.ms) && x.ms >= now)
      .sort((x, y) => x.ms - y.ms);
    return upcoming[0]?.a ?? null;
  }, [displayDetail?.recentAppointments]);

  const shownAppointments = useMemo(() => {
    if (!displayDetail) return [];
    if (appointmentsView === 'closest') {
      return closestUpcomingAppointment ? [closestUpcomingAppointment] : [];
    }
    return displayDetail.recentAppointments;
  }, [displayDetail, appointmentsView, closestUpcomingAppointment]);

  const openEdit = useCallback(() => {
    if (!displayDetail) return;
    setEditFirst(displayDetail.firstName);
    setEditLast(displayDetail.lastName);
    setEditPhone(displayDetail.phone);
    setEditBirth(displayDetail.birthDate ?? '');
    setFocusedField(null);
    setEditOpen(true);
  }, [displayDetail]);

  useEffect(() => {
    if (!token || !canAccessAdmin(role)) {
      (navigation.navigate as (name: string) => void)(hasStaffProfile ? 'StaffDashboard' : 'Home');
      return;
    }
    if (!customerId) return;

    const myGen = ++fetchGenRef.current;
    const summary = route.params?.initialSummary;
    const bootstrap = summary && summary.id === customerId ? listItemToDetail(summary) : null;
    const warm = getWarmAdminCustomerDetailsCached(customerId);
    if (warm && warm.id === customerId) {
      setDetail(warm);
      setError(null);
    } else if (bootstrap) {
      setDetail(bootstrap);
      setError(null);
    } else {
      setDetail(null);
    }
    setFetching(true);

    let cancelled = false;
    (async () => {
      try {
        const d = await getAdminCustomerDetails(token, customerId);
        if (cancelled || myGen !== fetchGenRef.current) return;
        setDetail(d);
        setWarmAdminCustomerDetails(customerId, d);
        setError(null);
      } catch (e) {
        if (cancelled || myGen !== fetchGenRef.current) return;
        const errMsg = e instanceof Error ? e.message : i18n.t('admin.loadFailed');
        setError(errMsg);
        if (!bootstrap) setDetail(null);
      } finally {
        if (!cancelled && myGen === fetchGenRef.current) setFetching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, role, hasStaffProfile, customerId, navigation, route.params?.initialSummary?.id]);

  const onPullRefresh = useCallback(async () => {
    if (!token || !customerId) return;
    const myGen = fetchGenRef.current;
    setRefreshing(true);
    try {
      const d = await getAdminCustomerDetails(token, customerId);
      if (myGen !== fetchGenRef.current) return;
      setDetail(d);
      setWarmAdminCustomerDetails(customerId, d);
      setError(null);
    } catch (e) {
      if (myGen !== fetchGenRef.current) return;
      setError(e instanceof Error ? e.message : i18n.t('admin.loadFailed'));
    } finally {
      if (myGen === fetchGenRef.current) setRefreshing(false);
    }
  }, [token, customerId]);

  const handleSaveEdit = async () => {
    if (!token || !customerId || !displayDetail) return;
    const fn = validateName(editFirst, t('admin.firstNamePh'));
    if (!fn.valid) {
      Alert.alert(t('admin.error'), fn.error);
      return;
    }
    const ln = validateName(editLast, t('admin.lastNamePh'));
    if (!ln.valid) {
      Alert.alert(t('admin.error'), ln.error);
      return;
    }
    const ph = validateStaffPhone(editPhone);
    if (!ph.valid) {
      Alert.alert(t('admin.error'), ph.error ?? t('admin.phoneInvalidShort'));
      return;
    }
    if (!editPhone.trim()) {
      Alert.alert(t('admin.error'), t('admin.phoneRequired'));
      return;
    }
    const birthTrim = editBirth.trim();
    let birthPayload: string | null | undefined = undefined;
    if (birthTrim === '') birthPayload = null;
    else {
      if (!isValidDateString(birthTrim)) {
        Alert.alert(t('admin.error'), t('admin.birthInvalidFormat'));
        return;
      }
      birthPayload = birthTrim;
    }
    setSaving(true);
    try {
      const updated = await patchAdminCustomer(token, customerId, {
        firstName: editFirst.trim(),
        lastName: editLast.trim(),
        phone: editPhone.trim(),
        birthDate: birthPayload,
      });
      setDetail(updated);
      setWarmAdminCustomerDetails(customerId, updated);
      queueAdminCustomersListMutation({ type: 'update', item: adminCustomerDetailsToListItem(updated) });
      Keyboard.dismiss();
      setEditOpen(false);
      Alert.alert('', t('admin.updatedOk'));
    } catch (e) {
      const raw = e instanceof Error ? e.message : t('admin.updateFailed');
      Alert.alert(t('admin.error'), mapPatchError(raw));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!token || !customerId || !displayDetail) return;
    Alert.alert(t('admin.deleteCustomerTitle'), t('admin.deleteCustomerMsg', { name: displayDetail.fullName || t('admin.customerFallback') }), [
      { text: t('admin.cancel'), style: 'cancel' },
      {
        text: t('admin.delete'),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteAdminCustomer(token, customerId);
            invalidateWarmAdminCustomerDetails(customerId);
            queueAdminCustomersListMutation({ type: 'delete', id: customerId });
            (navigation.navigate as (name: string) => void)('AdminCustomers');
            Alert.alert('', t('admin.deletedOk'));
          } catch (e) {
            Alert.alert(t('admin.error'), e instanceof Error ? e.message : t('admin.deleteFailed'));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const handleDeleteAllAppointments = useCallback(() => {
    if (!token || !customerId || !displayDetail || deletingAppointments) return;
    Alert.alert(t('admin.deleteRecentAppointmentsTitle'), t('admin.deleteRecentAppointmentsBody'), [
        { text: t('admin.cancel'), style: 'cancel' },
        {
          text: t('admin.delete'),
          style: 'destructive',
          onPress: async () => {
            setDeletingAppointments(true);
            try {
              await deleteAdminCustomerAppointments(token, customerId);
              setDetail((prev) => (prev ? { ...prev, recentAppointments: [], totalAppointments: 0, upcomingAppointments: 0, cancelledAppointments: 0, lastAppointmentAt: null } : prev));
              const fresh = await getAdminCustomerDetails(token, customerId);
              setDetail(fresh);
              setWarmAdminCustomerDetails(customerId, fresh);
              Alert.alert('', t('admin.deleteRecentAppointmentsOk'));
            } catch (e) {
              Alert.alert(t('admin.error'), e instanceof Error ? e.message : t('admin.deleteRecentAppointmentsFailed'));
            } finally {
              setDeletingAppointments(false);
            }
          },
        },
      ]);
  }, [token, customerId, displayDetail, deletingAppointments, t]);

  if (!token || !canAccessAdmin(role)) {
    return null;
  }

  if (!customerId) {
    return (
      <Screen style={styles.screen} noPadding>
        <BlackHeader title={t('admin.customerDetailsTitle')} onBackPress={() => navigation.navigate('AdminCustomers')} onMenuPress={() => openDrawer(navigation)} />
        <EmptyState message={t('admin.missingCustomerId')} icon="alert-circle-outline" />
      </Screen>
    );
  }

  const showFullScreenLoader = fetching && !displayDetail;
  const showErrorOnly = error && !displayDetail;

  if (showFullScreenLoader) {
    return (
      <Screen style={styles.screen} noPadding>
        <BlackHeader title={t('admin.customerDetailsTitle')} onBackPress={() => navigation.navigate('AdminCustomers')} onMenuPress={() => openDrawer(navigation)} />
        <View style={styles.center}>
          <LoadingState />
        </View>
      </Screen>
    );
  }

  if (showErrorOnly) {
    return (
      <Screen style={styles.screen} noPadding>
        <BlackHeader title={t('admin.customerDetailsTitle')} onBackPress={() => navigation.navigate('AdminCustomers')} onMenuPress={() => openDrawer(navigation)} />
        <EmptyState message={error ?? ''} icon="alert-circle-outline" />
      </Screen>
    );
  }

  if (!displayDetail) {
    return (
      <Screen style={styles.screen} noPadding>
        <BlackHeader title={t('admin.customerDetailsTitle')} onBackPress={() => navigation.navigate('AdminCustomers')} onMenuPress={() => openDrawer(navigation)} />
        <View style={styles.center}>
          <LoadingState />
        </View>
      </Screen>
    );
  }

  const d = displayDetail;

  return (
    <Screen style={styles.screen} noPadding>
      <BlackHeader
        title={t('admin.customerDetailsTitle')}
        onBackPress={() => navigation.navigate('AdminCustomers')}
        onMenuPress={() => openDrawer(navigation)}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenEnter replayOnFocus remountKey={appointmentsView} variant="rise" style={{ flexGrow: 1 }}>
        <View style={styles.profileCard}>
          <View style={styles.profileAvatar}>
            <Ionicons name="person" size={iconSize.lg} color={colors.textTertiary} />
          </View>
          <View style={styles.profileMain}>
            <Text style={styles.name} numberOfLines={2}>
              {d.fullName || t('admin.customerFallback')}
            </Text>
            {d.phone ? <Text style={styles.phone}>{formatPhoneDisplay(d.phone)}</Text> : null}
          </View>
          <View style={styles.profileActions}>
            <TouchableOpacity
              onPress={openEdit}
              disabled={saving}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('admin.editCustomerTitle')}
            >
              <Ionicons name="create-outline" size={iconSize.lg} color={colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleDelete}
              style={styles.deleteBtn}
              disabled={deleting || saving}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('admin.delete')}
              accessibilityState={{ disabled: deleting || saving, busy: deleting }}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <Ionicons name="trash-outline" size={iconSize.md} color={colors.danger} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.metaCard}>
          {d.birthDate ? (
            <View style={[styles.metaRow, styles.metaRowDivider]}>
              <Text style={styles.metaLabel}>{t('admin.metaBirthDate')}</Text>
              <Text style={styles.metaVal}>{formatBirth(d.birthDate)}</Text>
            </View>
          ) : (
            <View style={[styles.metaRow, styles.metaRowDivider]}>
              <Text style={styles.metaLabel}>{t('admin.metaBirthDate')}</Text>
              <Text style={styles.metaValMuted}>{t('admin.metaNotProvided')}</Text>
            </View>
          )}
          {d.createdAt ? (
            <View style={[styles.metaRow, styles.metaRowDivider]}>
              <Text style={styles.metaLabel}>{t('admin.metaRegistered')}</Text>
              <Text style={styles.metaVal}>{formatRegistered(d.createdAt)}</Text>
            </View>
          ) : null}
          {d.lastAppointmentAt ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{t('admin.metaLastAppointment')}</Text>
              <Text style={styles.metaVal}>{formatLastAppointment(d.lastAppointmentAt)}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.statsSectionLabel}>{t('admin.appointmentsSummary')}</Text>
        <View style={styles.statsRow}>
          <StatBox
            icon="calendar-outline"
            label={t('admin.statTotal')}
            value={d.totalAppointments}
            active={appointmentsView === 'all'}
            onPress={() => setAppointmentsView('all')}
          />
          <StatBox
            icon="time-outline"
            label={t('admin.statUpcoming')}
            value={d.upcomingAppointments}
            active={appointmentsView === 'closest'}
            onPress={() => setAppointmentsView('closest')}
          />
          <StatBox icon="close-circle-outline" label={t('admin.statCancelled')} value={d.cancelledAppointments} />
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t('admin.recentAppointments')}</Text>
          <TouchableOpacity
            onPress={handleDeleteAllAppointments}
            disabled={deletingAppointments || d.recentAppointments.length === 0}
            style={styles.sectionDeleteAllBtn}
          >
            {deletingAppointments ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <>
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.sectionDeleteAllText}>{t('admin.deleteAllAppointments')}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
        {shownAppointments.length > 0 ? (
          shownAppointments.map((a) => (
            <Keyed key={a.id}>
              <RecentCard appointment={a} localeTag={localeTag} locale={locale} />
            </Keyed>
          ))
        ) : fetching ? (
          <View style={styles.recentSilentPlaceholder} />
        ) : (
          <View style={styles.emptyApt}>
            <EmptyState
              title={appointmentsView === 'closest' ? t('admin.noClosestAppointmentTitle') : t('admin.noAppointmentsTitle')}
              message={appointmentsView === 'closest' ? t('admin.noClosestAppointmentMsg') : t('admin.noAppointmentsMsg')}
              icon="calendar-outline"
            />
          </View>
        )}
        </ScreenEnter>
      </ScrollView>

      <Modal visible={editOpen} animationType="slide" transparent onRequestClose={() => !saving && setEditOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => !saving && setEditOpen(false)} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalKav}
            keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 12 : 0}
          >
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
              <View style={styles.modalGrabber} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('admin.editCustomerTitle')}</Text>
                <Text style={styles.modalSubtitle}>{t('admin.editCustomerSub')}</Text>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalScroll}
              >
                <Text style={styles.fieldLabel}>{t('admin.firstNamePh')}</Text>
                <TextInput
                  style={[styles.input, focusedField === 'first' && styles.inputFocused]}
                  value={editFirst}
                  onChangeText={setEditFirst}
                  placeholder={t('admin.firstNamePh')}
                  placeholderTextColor={colors.textTertiary}
                  textAlign="right"
                  onFocus={() => setFocusedField('first')}
                  onBlur={() => setFocusedField(null)}
                />
                <Text style={styles.fieldLabel}>{t('admin.lastNamePh')}</Text>
                <TextInput
                  style={[styles.input, focusedField === 'last' && styles.inputFocused]}
                  value={editLast}
                  onChangeText={setEditLast}
                  placeholder={t('admin.lastNamePh')}
                  placeholderTextColor={colors.textTertiary}
                  textAlign="right"
                  onFocus={() => setFocusedField('last')}
                  onBlur={() => setFocusedField(null)}
                />
                <Text style={styles.fieldLabel}>{t('admin.fieldPhone')}</Text>
                <TextInput
                  style={[styles.input, focusedField === 'phone' && styles.inputFocused]}
                  value={editPhone}
                  onChangeText={setEditPhone}
                  placeholder={t('auth.phonePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="phone-pad"
                  textAlign="right"
                  onFocus={() => setFocusedField('phone')}
                  onBlur={() => setFocusedField(null)}
                />
                <Text style={styles.fieldLabel}>{t('admin.metaBirthDate')}</Text>
                <Text style={styles.fieldHint}>{t('admin.birthDateHint')}</Text>
                <TextInput
                  style={[styles.input, focusedField === 'birth' && styles.inputFocused]}
                  value={editBirth}
                  onChangeText={setEditBirth}
                  placeholder="1990-05-15"
                  placeholderTextColor={colors.textTertiary}
                  textAlign="right"
                  onFocus={() => setFocusedField('birth')}
                  onBlur={() => setFocusedField(null)}
                />
              </ScrollView>
              <View style={styles.modalFooter}>
                <AppButton
                  title={t('admin.cancel')}
                  variant="secondary"
                  style={styles.modalBtn}
                  onPress={() => {
                    Keyboard.dismiss();
                    if (!saving) setEditOpen(false);
                  }}
                  disabled={saving}
                />
                <AppButton title={t('admin.save')} variant="primary" style={styles.modalBtn} onPress={handleSaveEdit} loading={saving} disabled={saving} />
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  content: {
    ...presets.scrollContent,
    paddingTop: spacing.sm,
  },
  profileCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileMain: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md },
  name: { ...textStyles.bodyMedium, fontSize: 17, textAlign: 'right', color: colors.text },
  phone: { ...textStyles.bodySmall, textAlign: 'right', color: colors.textMuted, marginTop: 4 },
  profileActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.md },
  deleteBtn: { padding: spacing.xs },
  metaCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
    marginBottom: spacing.md,
    ...shadows.card,
  },
  metaRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  metaRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  metaLabel: { ...textStyles.caption, color: colors.textTertiary, textAlign: 'right' },
  metaVal: { ...textStyles.bodySmall, color: colors.text, fontWeight: '600', textAlign: 'left', flex: 1 },
  metaValMuted: { ...textStyles.bodySmall, color: colors.textMuted, textAlign: 'left', flex: 1 },
  statsSectionLabel: {
    ...textStyles.label,
    fontSize: 12,
    textAlign: 'right',
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statBox: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  statBoxActive: {
    borderColor: colors.accent + '88',
    backgroundColor: colors.accent + '10',
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.accent + '18',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  statIconWrapActive: {
    backgroundColor: colors.accent + '2A',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
  },
  statLabel: { ...textStyles.caption, fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 2, lineHeight: 14 },
  sectionHeaderRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  sectionTitle: { ...textStyles.sectionTitle, fontSize: 17, textAlign: 'right', marginBottom: spacing.sm, color: colors.text },
  sectionDeleteAllBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
  },
  sectionDeleteAllText: {
    ...textStyles.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  emptyApt: { marginVertical: spacing.sm },
  recentSilentPlaceholder: { minHeight: 40 },
  aptCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  aptTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  aptTime: { ...textStyles.bodyMedium, fontSize: 15, color: colors.text },
  aptStatus: { ...textStyles.caption, color: colors.accent, fontWeight: '700' },
  aptWhen: { ...textStyles.caption, color: colors.textMuted, marginTop: 4, textAlign: 'right' },
  aptService: { ...textStyles.bodyMedium, fontSize: 15, marginTop: spacing.xs, textAlign: 'right' },
  aptMeta: { ...textStyles.bodySmall, color: colors.textMuted, textAlign: 'right', marginTop: 4 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  modalKav: { width: '100%', maxHeight: Platform.OS === 'ios' ? '92%' : '94%' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '100%',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.sheet,
  },
  modalGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  modalHeader: { marginBottom: spacing.sm },
  modalTitle: { ...textStyles.sectionTitle, textAlign: 'right', marginBottom: spacing.xs },
  modalSubtitle: { ...textStyles.bodySmall, color: colors.textTertiary, textAlign: 'right' },
  modalScroll: { paddingBottom: spacing.md },
  fieldLabel: { ...textStyles.label, fontSize: 12, textAlign: 'right', marginBottom: spacing.xs, marginTop: spacing.xs },
  fieldHint: { ...textStyles.caption, color: colors.textTertiary, textAlign: 'right', marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    ...textStyles.body,
    marginBottom: spacing.md,
    minHeight: 48,
    textAlign: 'right',
  },
  inputFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  modalFooter: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    marginTop: spacing.xs,
  },
  modalBtn: { flex: 1, minHeight: 48, paddingVertical: 12 },
});
