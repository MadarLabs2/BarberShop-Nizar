import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Keyboard,
  Pressable,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { EmptyState } from '../../components/feedback/EmptyState';
import { AppButton } from '../../components/ui/AppButton';
import { prepareImageForUpload } from '../../utils/imageUpload';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { LoadingState } from '../../components/feedback/LoadingState';
import { useAuth } from '../../hooks/useAuth';
import { patchAuthUser } from '../../store/auth.store';
import { prefetchAdminStaffReport, prefetchAdminStaffReportsBatch } from '../../services/staffReportCache';
import { useAdminCatalog } from '../../hooks/useAdminCatalog';
import { formatPhoneDisplay } from '../../utils/phone';
import { validateName, validateStaffPhone, validateServicePrice, validateServiceDuration } from '../../utils/validators';
import { openDrawer } from '../../utils/nav';
import { colors, spacing, typography, radius, shadows, presets, textStyles, iconSize } from '../../theme';
import { canAccessAdmin } from '../../lib/navigation.roles';
import { Keyed } from '../../components/ui/Keyed';
import { WheelTimePickerSheet } from '../../components/ui/WheelTimePickerSheet';
import { type Staff } from '../../services/admin.api';

/** Hidden for now per product decision — logic/API/DB all stay intact, just not surfaced in the UI. Flip to re-show. */
const SHOW_STAFF_PERMISSION_TOGGLES = false;
import { WEEK_DAYS_ORDER } from '../../utils/dates';
import { validateWorkingTimeRange } from '../../utils/validators';

/** RTL: סניפים last (left end of row with row-reverse). */
const ADMIN_TAB_KEYS: { key: 'staff' | 'services' | 'branches' | 'workdays'; labelKey: string }[] = [
  { key: 'staff', labelKey: 'admin.adminTabStaff' },
  { key: 'services', labelKey: 'admin.adminTabServices' },
  { key: 'workdays', labelKey: 'admin.adminTabWorkdays' },
  { key: 'branches', labelKey: 'admin.adminTabBranches' },
];

export function AdminScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const route = useRoute();
  const { token, user, role, hasStaffProfile, fetchCurrentUser } = useAuth();

  useEffect(() => {
    if (!token) {
      (navigation.navigate as (name: string) => void)('Login');
    } else if (!canAccessAdmin(role)) {
      (navigation.navigate as (name: string) => void)(hasStaffProfile ? 'StaffDashboard' : 'Home');
    }
  }, [token, role, hasStaffProfile, navigation]);
  const params = route.params as { tab?: 'staff' | 'services' | 'branches' | 'workdays' } | undefined;
  const admin = useAdminCatalog(token, params);

  const staffReportWarmKey = useMemo(() => {
    if (admin.loading || !admin.staff?.length) return '';
    return admin.staff
      .filter((s) => s.isActive)
      .map((s) => s.id)
      .sort()
      .join(',');
  }, [admin.loading, admin.staff]);

  const lastStaffReportWarmKeyRef = useRef<string>('');
  useEffect(() => {
    if (!token || !staffReportWarmKey) return;
    if (staffReportWarmKey === lastStaffReportWarmKeyRef.current) return;
    lastStaffReportWarmKeyRef.current = staffReportWarmKey;
    const ids = staffReportWarmKey.split(',').filter(Boolean);
    void prefetchAdminStaffReportsBatch(token, ids);
  }, [token, staffReportWarmKey]);

  /** Staff modal: local image before upload; `staffImageRemoved` clears server avatar on save. */
  const [pickedStaffUri, setPickedStaffUri] = useState<string | null>(null);
  const [pickedStaffMime, setPickedStaffMime] = useState<string | null>(null);
  const [staffImageRemoved, setStaffImageRemoved] = useState(false);

  const resetStaffPhoto = useCallback(() => {
    setPickedStaffUri(null);
    setPickedStaffMime(null);
    setStaffImageRemoved(false);
  }, []);

  const pickStaffPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('admin.permissionGallery'), t('admin.permissionAvatar'));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.88,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const prepared = await prepareImageForUpload(asset.uri, asset.width, asset.height);
    setPickedStaffUri(prepared.uri);
    setPickedStaffMime(prepared.mimeType);
    setStaffImageRemoved(false);
  };

  const removeStaffPhoto = () => {
    setPickedStaffUri(null);
    setPickedStaffMime(null);
    setStaffImageRemoved(true);
  };

  /** Staff modal + save path when editing a team member from ימי עבודה (tab is workdays). */
  const isStaffModal =
    admin.activeTab === 'staff' ||
    (admin.activeTab === 'workdays' && !!admin.editItem && 'avatarUrl' in admin.editItem);

  const staffModalPreview = useMemo(() => {
    if (!isStaffModal) return null;
    const staffEd = admin.editItem && 'avatarUrl' in admin.editItem ? (admin.editItem as Staff) : null;
    if (pickedStaffUri) return { uri: pickedStaffUri };
    if (!staffImageRemoved && staffEd?.avatarUrl) return { uri: staffEd.avatarUrl };
    return null;
  }, [isStaffModal, admin.editItem, pickedStaffUri, staffImageRemoved]);

  /** Highlights the active field's border; keyboard-return chaining moves focus between fields. */
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const staffNameInputRef = useRef<TextInput>(null);
  const staffPhoneInputRef = useRef<TextInput>(null);
  const nameInputRef = useRef<TextInput>(null);
  const nameArInputRef = useRef<TextInput>(null);
  const priceInputRef = useRef<TextInput>(null);
  const durationInputRef = useRef<TextInput>(null);
  const addressInputRef = useRef<TextInput>(null);
  const wazeInputRef = useRef<TextInput>(null);
  const branchPhoneInputRef = useRef<TextInput>(null);
  const instagramInputRef = useRef<TextInput>(null);
  const googleMapsInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!admin.modalVisible) {
      setFocusedField(null);
      return;
    }
    const t = setTimeout(() => {
      (isStaffModal ? staffNameInputRef : nameInputRef).current?.focus();
    }, 260);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin.modalVisible]);

  const handleWorkdayPress = useCallback(
    (staffId: string, day: number) => admin.toggleWorkingDay(staffId, day),
    [admin.toggleWorkingDay]
  );

  const [workdayEdit, setWorkdayEdit] = useState<Record<string, { start: string; end: string }>>({});
  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null);
  const [staffServiceEdit, setStaffServiceEdit] = useState<{ linkId: string; price: string; duration: string } | null>(null);
  const staffServiceEditRef = useRef<{ linkId: string; price: string; duration: string } | null>(null);
  const updateStaffServiceEdit = useCallback((v: { linkId: string; price: string; duration: string } | null | ((prev: { linkId: string; price: string; duration: string } | null) => { linkId: string; price: string; duration: string } | null)) => {
    const next = typeof v === 'function' ? v(staffServiceEditRef.current) : v;
    staffServiceEditRef.current = next;
    setStaffServiceEdit(next);
  }, []);

  const toggleStaffExpanded = useCallback((staffId: string) => {
    setExpandedStaffId((prev) => (prev === staffId ? null : staffId));
  }, []);

  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);
  const toggleServiceExpanded = useCallback((serviceId: string) => {
    setExpandedServiceId((prev) => {
      const next = prev === serviceId ? null : serviceId;
      if (next !== prev) admin.setAddStaffServiceId(null);
      return next;
    });
  }, [admin.setAddStaffServiceId]);

  const [expandedBranchId, setExpandedBranchId] = useState<string | null>(null);
  const toggleBranchExpanded = useCallback((branchId: string) => {
    setExpandedBranchId((prev) => {
      const next = prev === branchId ? null : branchId;
      if (next !== prev) admin.setAddStaffBranch(null);
      return next;
    });
  }, [admin.setAddStaffBranch]);
  useEffect(() => {
    setWorkdayEdit((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next)) {
        const [staffId, dayStr] = key.split('-');
        const dayOfWeek = parseInt(dayStr, 10);
        const isWorkDay = (admin.staffWorkingDays?.[staffId] ?? []).some((x) => x.dayOfWeek === dayOfWeek);
        if (!isWorkDay) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [admin.staffWorkingDays]);
  const getWorkdayDisplay = useCallback(
    (staffId: string, dayOfWeek: number, field: 'start' | 'end') => {
      const key = `${staffId}-${dayOfWeek}`;
      const local = workdayEdit[key];
      if (local) return field === 'start' ? local.start : local.end;
      const entry = (admin.staffWorkingDays?.[staffId] ?? []).find((x) => x.dayOfWeek === dayOfWeek);
      return field === 'start' ? (entry?.startTime ?? '09:00') : (entry?.endTime ?? '19:00');
    },
    [workdayEdit, admin.staffWorkingDays]
  );
  const setWorkdayDisplay = useCallback(
    (staffId: string, dayOfWeek: number, field: 'start' | 'end', value: string) => {
      const key = `${staffId}-${dayOfWeek}`;
      setWorkdayEdit((prev) => {
        const cur = prev[key] ?? {
          start: (admin.staffWorkingDays?.[staffId] ?? []).find((x) => x.dayOfWeek === dayOfWeek)?.startTime ?? '09:00',
          end: (admin.staffWorkingDays?.[staffId] ?? []).find((x) => x.dayOfWeek === dayOfWeek)?.endTime ?? '19:00',
        };
        return { ...prev, [key]: { ...cur, [field]: value } };
      });
    },
    [admin.staffWorkingDays]
  );
  const handleWorkdayTimeBlur = useCallback(
    async (staffId: string, dayOfWeek: number) => {
      const key = `${staffId}-${dayOfWeek}`;
      const local = workdayEdit[key];
      if (!local) return;
      const start = local.start?.trim() || '09:00';
      const end = local.end?.trim() || '19:00';
      const r = validateWorkingTimeRange(start, end);
      if (!r.valid) return;
      await admin.updateStaffWorkingDayTime(staffId, dayOfWeek, start, end);
      setWorkdayEdit((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [workdayEdit, admin.updateStaffWorkingDayTime]
  );

  const [workdayTimePicker, setWorkdayTimePicker] = useState<{
    staffId: string;
    dayOfWeek: number;
    field: 'start' | 'end';
  } | null>(null);

  const handleWorkdayTimePicked = useCallback(
    async (time: string) => {
      const ctx = workdayTimePicker;
      if (!ctx) return;
      const { staffId, dayOfWeek, field } = ctx;
      const start = field === 'start' ? time : getWorkdayDisplay(staffId, dayOfWeek, 'start');
      const end = field === 'end' ? time : getWorkdayDisplay(staffId, dayOfWeek, 'end');
      const r = validateWorkingTimeRange(start, end);
      if (!r.valid) {
        Alert.alert(t('admin.error'), r.error);
        return;
      }
      const key = `${staffId}-${dayOfWeek}`;
      await admin.updateStaffWorkingDayTime(staffId, dayOfWeek, start, end);
      setWorkdayEdit((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [workdayTimePicker, getWorkdayDisplay, admin]
  );

  const titles = useMemo(
    (): Record<'staff' | 'services' | 'branches' | 'workdays', string> => ({
      staff: t('admin.adminTabStaff'),
      services: t('admin.adminTabServices'),
      branches: t('admin.adminTabBranches'),
      workdays: t('admin.adminTabWorkdays'),
    }),
    [t]
  );

  const confirmDelete = (item: { id: string; name: string }, kindKey: string) => {
    Alert.alert(t('admin.deleteTitle'), t('admin.deleteConfirm', { kind: t(kindKey), name: item.name }), [
      { text: t('admin.cancel'), style: 'cancel' },
      {
        text: t('admin.delete'),
        style: 'destructive',
        onPress: async () => {
          const result = await admin.handleDelete(item as any);
          if (result?.error) Alert.alert(t('admin.error'), result.error);
        },
      },
    ]);
  };

  const handleSave = async () => {
    const editedStaff =
      isStaffModal && admin.editItem && 'avatarUrl' in admin.editItem ? (admin.editItem as Staff) : null;
    const isEditingMyStaffProfile = !!user?.id && !!editedStaff?.profileId && editedStaff.profileId === user.id;

    if (isStaffModal) {
      const nameResult = validateName(admin.form.name);
      if (!nameResult.valid) {
        Alert.alert(t('admin.error'), nameResult.error);
        return;
      }
    } else {
      const nameHeResult = validateName(admin.form.nameHe, t('admin.nameHePh'));
      if (!nameHeResult.valid) {
        Alert.alert(t('admin.error'), nameHeResult.error);
        return;
      }
      const nameArResult = validateName(admin.form.nameAr, t('admin.nameArPh'));
      if (!nameArResult.valid) {
        Alert.alert(t('admin.error'), nameArResult.error);
        return;
      }
    }
    if (isStaffModal) {
      const phone = admin.form.phone.trim();
      if (!admin.editItem && !phone) {
        Alert.alert(t('admin.error'), t('admin.staffRequiredPhone'));
        return;
      }
      const phoneResult = validateStaffPhone(admin.form.phone);
      if (!phoneResult.valid) {
        Alert.alert(t('admin.error'), phoneResult.error);
        return;
      }
    }
    if (admin.activeTab === 'services') {
      const priceResult = validateServicePrice(admin.form.price);
      if (!priceResult.valid) {
        Alert.alert(t('admin.error'), priceResult.error);
        return;
      }
      const durationResult = validateServiceDuration(admin.form.duration);
      if (!durationResult.valid) {
        Alert.alert(t('admin.error'), durationResult.error);
        return;
      }
    }
    const result = await admin.handleSave(
      isStaffModal
        ? {
            staffAvatarUri: pickedStaffUri ?? undefined,
            staffAvatarMime: pickedStaffMime,
            staffAvatarRemove: !!(admin.editItem && staffImageRemoved && !pickedStaffUri),
          }
        : undefined
    );
    if (result?.error) Alert.alert(t('admin.error'), result.error);
    else if (isStaffModal) {
      if (isEditingMyStaffProfile) {
        if (pickedStaffUri) {
          patchAuthUser((prev) => ({ ...prev, avatarUrl: pickedStaffUri }));
        } else if (staffImageRemoved) {
          patchAuthUser((prev) => ({ ...prev, avatarUrl: null }));
        }
      }
      resetStaffPhoto();
      void fetchCurrentUser();
    }
  };

  if (!token || !canAccessAdmin(role)) {
    return null;
  }

  if (admin.loading) {
    return (
      <Screen style={styles.screenWrap} noPadding>
        <BlackHeader title={titles[admin.activeTab]} onBackPress={() => navigation.navigate('Dashboard')} onMenuPress={() => openDrawer(navigation)} />
        <LoadingState />
      </Screen>
    );
  }

  return (
    <Screen style={styles.screenWrap} noPadding>
      <BlackHeader
        title={titles[admin.activeTab]}
        onBackPress={() => navigation.navigate('Dashboard')}
        onMenuPress={() => openDrawer(navigation)}
      />

      <View style={styles.tabBarOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabBarScroll}
          contentContainerStyle={styles.tabBarContent}
        >
          {ADMIN_TAB_KEYS.map(({ key, labelKey }) => {
            const isActive = admin.activeTab === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => admin.setActiveTab(key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]} numberOfLines={1}>
                  {t(labelKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={admin.refreshing} onRefresh={admin.onRefresh} />}
      >
        <ScreenEnter replayOnFocus remountKey={admin.activeTab} variant="rise" style={{ flexGrow: 1 }}>
        {admin.activeTab === 'staff' && (
          <>
            <TouchableOpacity
              style={styles.addBtnCompact}
              onPress={() => {
                resetStaffPhoto();
                admin.openAdd();
              }}
              activeOpacity={0.88}
            >
              <Ionicons name="add" size={20} color={colors.surface} />
              <Text style={styles.addBtnCompactText}>{t('admin.addStaffMember')}</Text>
            </TouchableOpacity>
            <Text style={styles.staffReportHint}>{t('admin.staffTapStaffRowHint')}</Text>
            {admin.staff.filter((s) => s.isActive).length === 0 ? (
              <EmptyState title={t('admin.emptyStaffTitle')} message={t('admin.emptyStaffMsg')} icon="people-outline" />
            ) : admin.staff.filter((s) => s.isActive).map((s) => (
              <Keyed key={s.id}>
              <View style={styles.staffCard}>
              <View style={[styles.listItem, styles.listItemRow]}>
                <TouchableOpacity
                  style={styles.staffRowPress}
                  onPressIn={() => {
                    if (token) prefetchAdminStaffReport(token, s.id);
                  }}
                  onPress={() =>
                    (navigation.navigate as (name: string, params?: object) => void)('AdminStaffReport', {
                      staffId: s.id,
                      staffName: s.name,
                      returnTo: 'adminStaff',
                    })
                  }
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={t('admin.staffReportScreenTitle')}
                >
                  <View style={styles.staffListAvatarWrap}>
                    {s.avatarUrl ? (
                      <ExpoImage
                        source={{ uri: s.avatarUrl }}
                        style={styles.staffListAvatarImg}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={0}
                      />
                    ) : (
                      <View style={styles.staffListAvatarPlaceholder}>
                        <Ionicons name="person" size={22} color={colors.textMuted} />
                      </View>
                    )}
                  </View>
                  <View style={styles.listItemMain}>
                    <View style={presets.rowHebrew}>
                      <Text style={styles.listItemText}>{s.name}</Text>
                      {user?.id && s.profileId === user.id ? (
                        <View style={styles.myStaffBadge}>
                          <Text style={styles.myStaffBadgeText}>{t('admin.myStaffRowBadge')}</Text>
                        </View>
                      ) : null}
                    </View>
                    {s.phone ? <Text style={styles.listItemPhone}>{formatPhoneDisplay(s.phone)}</Text> : null}
                  </View>
                </TouchableOpacity>
                <View style={styles.listItemActions}>
                  <TouchableOpacity
                    onPress={() => {
                      resetStaffPhoto();
                      admin.openEdit(s);
                    }}
                    disabled={admin.deletingItemId === s.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('admin.modalStaffEdit')}: ${s.name}`}
                  >
                    <Ionicons name="create-outline" size={iconSize.lg} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => confirmDelete(s, 'admin.kindStaff')}
                    style={styles.deleteBtn}
                    disabled={!!admin.deletingItemId}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('admin.delete')}: ${s.name}`}
                    accessibilityState={{ disabled: !!admin.deletingItemId, busy: admin.deletingItemId === s.id }}
                  >
                    {admin.deletingItemId === s.id ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <Ionicons name="trash-outline" size={iconSize.md} color={colors.danger} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {SHOW_STAFF_PERMISSION_TOGGLES && (
              <>
              <Text style={styles.staffPermissionsLabel}>{t('admin.staffPermissionsLabel')}</Text>
              <View style={styles.staffPermissionsRow}>
                <TouchableOpacity
                  style={[styles.permissionChip, s.canBlockOwnTime && styles.permissionChipActive]}
                  onPress={async () => {
                    const result = await admin.toggleStaffCanBlockOwnTime(s.id, !s.canBlockOwnTime);
                    if (result?.error) Alert.alert(t('admin.error'), result.error);
                  }}
                  disabled={admin.togglingBlockPermissionId === s.id}
                  activeOpacity={0.78}
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    s.canBlockOwnTime ? 'admin.revokeBlockPermission' : 'admin.grantBlockPermission',
                  )}
                >
                  {admin.togglingBlockPermissionId === s.id ? (
                    <ActivityIndicator size="small" color={s.canBlockOwnTime ? colors.surface : colors.accent} />
                  ) : (
                    <Ionicons
                      name={s.canBlockOwnTime ? 'checkmark-circle' : 'ellipse-outline'}
                      size={16}
                      color={s.canBlockOwnTime ? colors.surface : colors.textTertiary}
                    />
                  )}
                  <Text style={[styles.permissionChipText, s.canBlockOwnTime && styles.permissionChipTextActive]}>
                    {t('admin.permissionBlockedTimes')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.permissionChip, s.canSetOwnWorkingHours && styles.permissionChipActive]}
                  onPress={async () => {
                    const result = await admin.toggleStaffCanSetOwnWorkingHours(s.id, !s.canSetOwnWorkingHours);
                    if (result?.error) Alert.alert(t('admin.error'), result.error);
                  }}
                  disabled={admin.togglingWorkingHoursPermissionId === s.id}
                  activeOpacity={0.78}
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    s.canSetOwnWorkingHours ? 'admin.revokeWorkingHoursPermission' : 'admin.grantWorkingHoursPermission',
                  )}
                >
                  {admin.togglingWorkingHoursPermissionId === s.id ? (
                    <ActivityIndicator size="small" color={s.canSetOwnWorkingHours ? colors.surface : colors.accent} />
                  ) : (
                    <Ionicons
                      name={s.canSetOwnWorkingHours ? 'checkmark-circle' : 'ellipse-outline'}
                      size={16}
                      color={s.canSetOwnWorkingHours ? colors.surface : colors.textTertiary}
                    />
                  )}
                  <Text
                    style={[styles.permissionChipText, s.canSetOwnWorkingHours && styles.permissionChipTextActive]}
                  >
                    {t('admin.permissionWorkingHours')}
                  </Text>
                </TouchableOpacity>
              </View>
              </>
              )}
              </View>
              </Keyed>
            ))}
          </>
        )}

        {admin.activeTab === 'services' && (
          <>
            <TouchableOpacity style={styles.addBtnCompact} onPress={admin.openAdd} activeOpacity={0.88}>
              <Ionicons name="add" size={20} color={colors.surface} />
              <Text style={styles.addBtnCompactText}>{t('admin.addService')}</Text>
            </TouchableOpacity>
            <Text style={styles.servicesHint}>{t('admin.servicesHintExpand')}</Text>
            {admin.services.filter((s) => s.isActive).length === 0 ? (
              <EmptyState title={t('admin.emptyServicesTitle')} message={t('admin.emptyServicesMsg')} icon="cut-outline" />
            ) : admin.services.filter((s) => s.isActive).map((s) => {
              const isServiceExpanded = expandedServiceId === s.id;
              const staffCount = (admin.staffServiceMap[s.id] ?? []).length;
              return (
              <Keyed key={s.id}>
              <View style={[styles.serviceCard, styles.catalogCard, isServiceExpanded && styles.workdaysCardExpanded]}>
                <View style={styles.serviceCardHeader}>
                  <TouchableOpacity
                    style={styles.serviceCardHeaderTouch}
                    onPress={() => toggleServiceExpanded(s.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.serviceCardHeaderContent}>
                      <Text style={styles.serviceCardTitle}>{s.nameHe}</Text>
                      <Text style={styles.serviceCardMeta}>{s.nameAr}</Text>
                      <Text style={[styles.serviceCardMeta, styles.serviceStaffSummary]}>
                        {staffCount > 0 ? t('admin.staffLinkedCount', { count: staffCount }) : t('admin.staffLinkedNone')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <View style={styles.serviceCardHeaderActions}>
                    <TouchableOpacity
                      onPress={() => admin.openEdit(s)}
                      disabled={admin.deletingItemId === s.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('admin.modalServiceEdit')}: ${s.nameHe}`}
                    >
                      <Ionicons name="create-outline" size={iconSize.lg} color={colors.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => confirmDelete(s, 'admin.kindService')}
                      style={styles.deleteBtn}
                      disabled={!!admin.deletingItemId}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('admin.delete')}: ${s.nameHe}`}
                      accessibilityState={{ disabled: !!admin.deletingItemId, busy: admin.deletingItemId === s.id }}
                    >
                      {admin.deletingItemId === s.id ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Ionicons name="trash-outline" size={iconSize.md} color={colors.danger} />
                      )}
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.serviceCardHeaderChevronBtn}
                    onPress={() => toggleServiceExpanded(s.id)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
                    accessibilityRole="button"
                    accessibilityLabel={isServiceExpanded ? t('admin.collapseA11y') : t('admin.expandA11y')}
                    accessibilityState={{ expanded: isServiceExpanded }}
                  >
                    <Ionicons
                      name={isServiceExpanded ? 'chevron-up' : 'chevron-down'}
                      size={iconSize.md}
                      color={isServiceExpanded ? colors.accent : colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>
                {isServiceExpanded && (
                <View style={styles.serviceStaffSection}>
                  <Text style={styles.serviceStaffSectionLabel}>{t('admin.serviceStaffPriceDuration')}</Text>
                  {(admin.staffServiceMap[s.id] ?? []).length === 0 ? (
                    <Text style={styles.serviceStaffEmpty}>{t('admin.serviceStaffEmptyHint')}</Text>
                  ) : null}
                  <View style={styles.serviceStaffGroupedList}>
                    {(admin.staffServiceMap[s.id] ?? []).map((st, rowIdx, arr) => (
                      <Keyed key={st.linkId}>
                      <View style={[styles.serviceStaffRowCard, rowIdx < arr.length - 1 && styles.serviceStaffRowDivider]}>
                        <Text style={styles.serviceStaffRowNameTop}>{st.staffName}</Text>
                        <View style={styles.serviceStaffRowInputs}>
                          <View style={styles.serviceStaffFieldGroup}>
                            <Text style={styles.serviceStaffFieldLbl}>{t('admin.shekelMark')}</Text>
                            <TextInput
                              style={styles.serviceStaffInputFlex}
                              value={staffServiceEdit?.linkId === st.linkId ? staffServiceEdit.price : String(st.price)}
                              onChangeText={(v) => updateStaffServiceEdit((e) => (e?.linkId === st.linkId ? { ...e, price: v } : { linkId: st.linkId, price: v, duration: String(st.duration) }))}
                              onFocus={() => updateStaffServiceEdit((e) => (e?.linkId === st.linkId ? e : { linkId: st.linkId, price: String(st.price), duration: String(st.duration) }))}
                              onBlur={async () => {
                                const e = staffServiceEditRef.current;
                                if (e?.linkId !== st.linkId) return;
                                const p = parseInt(e.price, 10);
                                if (!Number.isNaN(p) && p >= 0 && (p !== st.price || parseInt(e.duration, 10) !== st.duration)) {
                                  const d = parseInt(e.duration, 10);
                                  const dur = !Number.isNaN(d) && d >= 5 && d <= 180 ? d : st.duration;
                                  await admin.handleUpdateStaffService(st.linkId, p, dur);
                                }
                                updateStaffServiceEdit(null);
                              }}
                              placeholder={t('admin.pricePh')}
                              placeholderTextColor={colors.textMuted}
                              keyboardType="numeric"
                              selectTextOnFocus
                            />
                          </View>
                          <View style={styles.serviceStaffFieldGroup}>
                            <Text style={styles.serviceStaffFieldLbl}>{t('admin.minutesMark')}</Text>
                            <TextInput
                              style={styles.serviceStaffInputFlex}
                              value={staffServiceEdit?.linkId === st.linkId ? staffServiceEdit.duration : String(st.duration)}
                              onChangeText={(v) => updateStaffServiceEdit((e) => (e?.linkId === st.linkId ? { ...e, duration: v } : { linkId: st.linkId, price: String(st.price), duration: v }))}
                              onFocus={() => updateStaffServiceEdit((e) => (e?.linkId === st.linkId ? e : { linkId: st.linkId, price: String(st.price), duration: String(st.duration) }))}
                              onBlur={async () => {
                                const e = staffServiceEditRef.current;
                                if (e?.linkId !== st.linkId) return;
                                const d = parseInt(e.duration, 10);
                                if (!Number.isNaN(d) && d >= 5 && d <= 180 && (d !== st.duration || parseInt(e.price, 10) !== st.price)) {
                                  const p = parseInt(e.price, 10);
                                  const prc = !Number.isNaN(p) && p >= 0 ? p : st.price;
                                  await admin.handleUpdateStaffService(st.linkId, prc, d);
                                }
                                updateStaffServiceEdit(null);
                              }}
                              placeholder={t('admin.minutesPh')}
                              placeholderTextColor={colors.textMuted}
                              keyboardType="numeric"
                              selectTextOnFocus
                            />
                          </View>
                          <TouchableOpacity
                            onPress={() => admin.handleRemoveStaffService(st.linkId)}
                            style={styles.serviceStaffRemove}
                            disabled={admin.removingStaffServiceId === st.linkId}
                            accessibilityRole="button"
                            accessibilityLabel={`${t('admin.removeA11y')}: ${st.staffName}`}
                            accessibilityState={{ disabled: admin.removingStaffServiceId === st.linkId, busy: admin.removingStaffServiceId === st.linkId }}
                          >
                            {admin.removingStaffServiceId === st.linkId ? (
                              <ActivityIndicator size="small" color={colors.danger} />
                            ) : (
                              <Ionicons name="trash-outline" size={iconSize.md} color={colors.danger} />
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                      </Keyed>
                    ))}
                  </View>
                  <View style={styles.branchStaffChips}>
                    <TouchableOpacity
                      style={styles.branchStaffAddBtn}
                      onPress={() => admin.setAddStaffServiceId(admin.addStaffServiceId === s.id ? null : s.id)}
                    >
                      <Ionicons name="add" size={16} color={colors.accent} />
                      <Text style={styles.branchStaffAddText}>{t('admin.addShort')}</Text>
                    </TouchableOpacity>
                  </View>
                  {admin.addStaffServiceId === s.id && (
                    <View style={styles.branchStaffPicker}>
                      {admin.staff
                        .filter((st) => st.isActive && !(admin.staffServiceMap[s.id] ?? []).some((x) => x.staffId === st.id))
                        .map((st) => (
                        <TouchableOpacity
                          key={st.id}
                          style={styles.branchStaffPickerItem}
                          onPress={() => admin.handleAddStaffService(s.id, st.id)}
                          disabled={!!(admin.addingStaffService?.serviceId === s.id && admin.addingStaffService?.staffId === st.id)}
                        >
                          {admin.addingStaffService?.serviceId === s.id && admin.addingStaffService?.staffId === st.id ? (
                            <ActivityIndicator size="small" color={colors.accent} />
                          ) : (
                            <Text style={styles.branchStaffPickerText}>{st.name}</Text>
                          )}
                        </TouchableOpacity>
                        ))}
                      {admin.staff.filter((st) => st.isActive && !(admin.staffServiceMap[s.id] ?? []).some((x) => x.staffId === st.id)).length === 0 && (
                        <Text style={styles.branchStaffEmpty}>{t('admin.branchStaffEmptyMore')}</Text>
                      )}
                    </View>
                  )}
                </View>
                )}
              </View>
              </Keyed>
            );
            })}
          </>
        )}

        {admin.activeTab === 'workdays' && (
          <>
            <Text style={styles.workdaysPageTitle}>{t('admin.workdaysMainTitle')}</Text>
            <Text style={styles.workdaysHint}>{t('admin.workdaysExpandHint')}</Text>
            {admin.staff.filter((s) => s.isActive).map((s) => {
              const isExpanded = expandedStaffId === s.id;
              const workdaysCount = (admin.staffWorkingDays?.[s.id] ?? []).length;
              return (
                <Keyed key={s.id}>
                  <View style={[styles.serviceCard, styles.catalogCard, isExpanded && styles.workdaysCardExpanded]}>
                    <View style={styles.serviceCardHeader}>
                      <TouchableOpacity
                        style={styles.serviceCardHeaderTouch}
                        onPress={() => toggleStaffExpanded(s.id)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.serviceCardHeaderContent}>
                          <Text style={styles.serviceCardTitle}>{s.name}</Text>
                          <Text style={[styles.serviceCardMeta, styles.serviceStaffSummary]}>
                            {workdaysCount > 0 ? t('admin.workdaysLinkedCount', { count: workdaysCount }) : t('admin.workdaysLinkedNone')}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      <View style={styles.serviceCardHeaderActions}>
                        <TouchableOpacity
                          onPress={() => {
                            resetStaffPhoto();
                            admin.openEdit(s);
                          }}
                          disabled={admin.deletingItemId === s.id}
                          accessibilityRole="button"
                          accessibilityLabel={`${t('admin.modalStaffEdit')}: ${s.name}`}
                        >
                          <Ionicons name="create-outline" size={iconSize.lg} color={colors.accent} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => confirmDelete(s, 'admin.kindStaff')}
                          style={styles.deleteBtn}
                          disabled={!!admin.deletingItemId}
                          accessibilityRole="button"
                          accessibilityLabel={`${t('admin.delete')}: ${s.name}`}
                          accessibilityState={{ disabled: !!admin.deletingItemId, busy: admin.deletingItemId === s.id }}
                        >
                          {admin.deletingItemId === s.id ? (
                            <ActivityIndicator size="small" color={colors.danger} />
                          ) : (
                            <Ionicons name="trash-outline" size={iconSize.md} color={colors.danger} />
                          )}
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        style={styles.serviceCardHeaderChevronBtn}
                        onPress={() => toggleStaffExpanded(s.id)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
                        accessibilityRole="button"
                        accessibilityLabel={isExpanded ? t('admin.collapseA11y') : t('admin.expandA11y')}
                        accessibilityState={{ expanded: isExpanded }}
                      >
                        <Ionicons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={iconSize.md}
                          color={isExpanded ? colors.accent : colors.textMuted}
                        />
                      </TouchableOpacity>
                    </View>
                    {isExpanded && (
                      <View style={presets.expandableBody}>
                        {WEEK_DAYS_ORDER.map((d) => {
                          const toggleKey = `${s.id}-${d}`;
                          const entry = (admin.staffWorkingDays?.[s.id] ?? []).find((x) => x.dayOfWeek === d);
                          const isWorkDay = !!entry;
                          const timeKey = `${s.id}-${d}`;
                          const isUpdating = admin.updatingWorkingDayTime === timeKey;
                          return (
                            <Keyed key={d}>
                              <View style={styles.workdaysDayRow}>
                                <TouchableOpacity
                                  style={[styles.workdaysDay, isWorkDay && styles.workdaysDayActive]}
                                  onPress={() => handleWorkdayPress(s.id, d)}
                                  disabled={admin.togglingWorkingDay === toggleKey}
                                >
                                  <Text style={[styles.workdaysDayText, isWorkDay && styles.workdaysDayTextActive]}>
                                    {t(`admin.wd${d}`)}
                                  </Text>
                                </TouchableOpacity>
                                {isWorkDay && (
                                  <View style={styles.workdaysTimesRow}>
                                    <TouchableOpacity
                                      style={[styles.workdaysTimeInput, isUpdating && styles.workdaysTimeInputDisabled]}
                                      onPress={() =>
                                        setWorkdayTimePicker({ staffId: s.id, dayOfWeek: d, field: 'start' })
                                      }
                                      disabled={isUpdating}
                                      activeOpacity={0.75}
                                    >
                                      <Text style={styles.workdaysTimeInputText}>
                                        {getWorkdayDisplay(s.id, d, 'start')}
                                      </Text>
                                    </TouchableOpacity>
                                    <Text style={styles.workdaysTimeSep}>–</Text>
                                    <TouchableOpacity
                                      style={[styles.workdaysTimeInput, isUpdating && styles.workdaysTimeInputDisabled]}
                                      onPress={() =>
                                        setWorkdayTimePicker({ staffId: s.id, dayOfWeek: d, field: 'end' })
                                      }
                                      disabled={isUpdating}
                                      activeOpacity={0.75}
                                    >
                                      <Text style={styles.workdaysTimeInputText}>
                                        {getWorkdayDisplay(s.id, d, 'end')}
                                      </Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                            </Keyed>
                          );
                        })}
                      </View>
                    )}
                  </View>
                </Keyed>
              );
            })}
          </>
        )}

        {admin.activeTab === 'branches' && (
          <>
            <TouchableOpacity style={styles.addBtnCompact} onPress={admin.openAdd} activeOpacity={0.88}>
              <Ionicons name="add" size={20} color={colors.surface} />
              <Text style={styles.addBtnCompactText}>{t('admin.addBranch')}</Text>
            </TouchableOpacity>
            <Text style={styles.servicesHint}>{t('admin.branchesHintExpand')}</Text>
            {admin.branches.filter((b) => b.isActive).length === 0 ? (
              <EmptyState title={t('admin.emptyBranchesTitle')} message={t('admin.emptyBranchesMsg')} icon="business-outline" />
            ) : admin.branches.filter((b) => b.isActive).map((b) => {
              const isBranchExpanded = expandedBranchId === b.id;
              const staffCount = (admin.branchStaffMap[b.id] ?? []).length;
              return (
              <Keyed key={b.id}>
              <View style={[styles.serviceCard, styles.catalogCard, isBranchExpanded && styles.workdaysCardExpanded]}>
                <View style={styles.serviceCardHeader}>
                  <TouchableOpacity
                    style={styles.serviceCardHeaderTouch}
                    onPress={() => toggleBranchExpanded(b.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.serviceCardHeaderContent}>
                      <Text style={styles.serviceCardTitle}>{b.nameHe}</Text>
                      <Text style={styles.serviceCardMeta}>{b.nameAr}</Text>
                      {b.address ? <Text style={styles.serviceCardMeta}>{b.address}</Text> : null}
                      <Text style={[styles.serviceCardMeta, styles.branchStaffLine]}>
                        {staffCount > 0 ? t('admin.branchStaffCount', { count: staffCount }) : t('admin.branchStaffNone')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <View style={styles.serviceCardHeaderActions}>
                    <TouchableOpacity
                      onPress={() => admin.openEdit(b)}
                      disabled={admin.deletingItemId === b.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('admin.modalBranchEdit')}: ${b.nameHe}`}
                    >
                      <Ionicons name="create-outline" size={iconSize.lg} color={colors.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => confirmDelete(b, 'admin.kindBranch')}
                      style={styles.deleteBtn}
                      disabled={!!admin.deletingItemId}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('admin.delete')}: ${b.nameHe}`}
                      accessibilityState={{ disabled: !!admin.deletingItemId, busy: admin.deletingItemId === b.id }}
                    >
                      {admin.deletingItemId === b.id ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Ionicons name="trash-outline" size={iconSize.md} color={colors.danger} />
                      )}
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.serviceCardHeaderChevronBtn}
                    onPress={() => toggleBranchExpanded(b.id)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
                    accessibilityRole="button"
                    accessibilityLabel={isBranchExpanded ? t('admin.collapseA11y') : t('admin.expandA11y')}
                    accessibilityState={{ expanded: isBranchExpanded }}
                  >
                    <Ionicons
                      name={isBranchExpanded ? 'chevron-up' : 'chevron-down'}
                      size={iconSize.md}
                      color={isBranchExpanded ? colors.accent : colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>
                {isBranchExpanded && (
                <View style={styles.branchStaffSection}>
                  <Text style={styles.serviceStaffSectionLabel}>{t('admin.branchStaffInBranch')}</Text>
                  {(admin.branchStaffMap[b.id] ?? []).length === 0 ? (
                    <Text style={styles.serviceStaffEmpty}>{t('admin.serviceStaffEmptyHint')}</Text>
                  ) : null}
                  <View style={styles.branchStaffChips}>
                    {(admin.branchStaffMap[b.id] ?? []).map((s) => (
                      <Keyed key={s.linkId}>
                      <View style={styles.branchStaffChip}>
                        <Text style={styles.branchStaffChipText}>{s.staffName}</Text>
                        <TouchableOpacity
                          onPress={() => admin.handleRemoveBranchStaff(s.linkId)}
                          style={styles.branchStaffChipRemove}
                          disabled={admin.removingLinkId === s.linkId}
                          accessibilityRole="button"
                          accessibilityLabel={`${t('admin.removeA11y')}: ${s.staffName}`}
                          accessibilityState={{ disabled: admin.removingLinkId === s.linkId, busy: admin.removingLinkId === s.linkId }}
                        >
                          {admin.removingLinkId === s.linkId ? (
                            <ActivityIndicator size="small" color={colors.accent} />
                          ) : (
                            <Ionicons name="close-circle" size={18} color={colors.accent} />
                          )}
                        </TouchableOpacity>
                      </View>
                      </Keyed>
                    ))}
                    <TouchableOpacity
                      style={styles.branchStaffAddBtn}
                      onPress={() => admin.setAddStaffBranch(admin.addStaffBranch === b.id ? null : b.id)}
                    >
                      <Ionicons name="add" size={16} color={colors.accent} />
                      <Text style={styles.branchStaffAddText}>{t('admin.addShort')}</Text>
                    </TouchableOpacity>
                  </View>
                  {admin.addStaffBranch === b.id && (
                    <View style={styles.branchStaffPicker}>
                      {admin.staff
                        .filter((s) => s.isActive && !(admin.branchStaffMap[b.id] ?? []).some((x) => x.staffId === s.id))
                        .map((st) => (
                        <TouchableOpacity
                          key={st.id}
                          style={styles.branchStaffPickerItem}
                          onPress={() => admin.handleAddBranchStaff(b.id, st.id)}
                          disabled={!!(admin.addingBranchStaff?.branchId === b.id && admin.addingBranchStaff?.staffId === st.id)}
                        >
                          {admin.addingBranchStaff?.branchId === b.id && admin.addingBranchStaff?.staffId === st.id ? (
                            <ActivityIndicator size="small" color={colors.accent} />
                          ) : (
                            <Text style={styles.branchStaffPickerText}>{st.name}</Text>
                          )}
                        </TouchableOpacity>
                        ))}
                      {admin.staff.filter((s) => s.isActive && !(admin.branchStaffMap[b.id] ?? []).some((x) => x.staffId === s.id)).length === 0 && (
                        <Text style={styles.branchStaffEmpty}>{t('admin.branchStaffEmptyMore')}</Text>
                      )}
                    </View>
                  )}
                </View>
                )}
              </View>
              </Keyed>
            );
            })}
          </>
        )}
        </ScreenEnter>
      </ScrollView>

      <Modal visible={admin.modalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          style={adminFormStyles.overlay}
          behavior={Platform.OS === 'ios' ? 'position' : 'padding'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? -12 : 0}
        >
          <Pressable style={adminFormStyles.backdropTapTarget} onPress={Keyboard.dismiss} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={adminFormStyles.overlayScroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={adminFormStyles.content}>
              <Text style={adminFormStyles.title}>
                {isStaffModal
                  ? admin.editItem
                    ? t('admin.modalStaffEdit')
                    : t('admin.modalStaffNew')
                  : admin.activeTab === 'services'
                    ? admin.editItem
                      ? t('admin.modalServiceEdit')
                      : t('admin.modalServiceNew')
                    : admin.editItem
                      ? t('admin.modalBranchEdit')
                      : t('admin.modalBranchNew')}
              </Text>
              {isStaffModal && (
                <View style={adminFormStyles.staffTopRow}>
                  {staffModalPreview ? (
                    <ExpoImage
                      source={staffModalPreview}
                      style={adminFormStyles.staffPhotoPreview}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={0}
                    />
                  ) : (
                    <View style={[adminFormStyles.staffPhotoPreview, adminFormStyles.staffPhotoPlaceholder]}>
                      <Ionicons name="person" size={36} color={colors.textMuted} />
                    </View>
                  )}
                  <View style={adminFormStyles.staffFieldsCol}>
                    <TextInput
                      ref={staffNameInputRef}
                      style={[adminFormStyles.inputTight, focusedField === 'staffName' && adminFormStyles.inputFocused]}
                      placeholder={t('admin.fullNamePh')}
                      value={admin.form.name}
                      onChangeText={(tx) => admin.setForm((f) => ({ ...f, name: tx }))}
                      placeholderTextColor={colors.textMuted}
                      onFocus={() => setFocusedField('staffName')}
                      onBlur={() => setFocusedField(null)}
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => staffPhoneInputRef.current?.focus()}
                    />
                    <TextInput
                      ref={staffPhoneInputRef}
                      style={[adminFormStyles.inputTight, focusedField === 'staffPhone' && adminFormStyles.inputFocused]}
                      placeholder={t('admin.phoneStaffPh')}
                      value={admin.form.phone}
                      onChangeText={(tx) => admin.setForm((f) => ({ ...f, phone: tx }))}
                      keyboardType="phone-pad"
                      placeholderTextColor={colors.textMuted}
                      onFocus={() => setFocusedField('staffPhone')}
                      onBlur={() => setFocusedField(null)}
                      returnKeyType="done"
                      onSubmitEditing={() => Keyboard.dismiss()}
                    />
                  </View>
                </View>
              )}
              {isStaffModal && (
                <View style={adminFormStyles.staffPhotoActionsRow}>
                  <TouchableOpacity style={adminFormStyles.staffPhotoPickBtnSm} onPress={pickStaffPhoto} activeOpacity={0.85}>
                    <Ionicons name="image-outline" size={18} color={colors.accent} />
                    <Text style={adminFormStyles.staffPhotoPickTextSm}>{t('admin.staffPhotoLabel')}</Text>
                  </TouchableOpacity>
                  {(pickedStaffUri ||
                    (admin.editItem &&
                      'avatarUrl' in admin.editItem &&
                      !!(admin.editItem as Staff).avatarUrl &&
                      !staffImageRemoved)) && (
                    <TouchableOpacity onPress={removeStaffPhoto} hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}>
                      <Text style={adminFormStyles.staffPhotoRemoveText}>{t('admin.removePhotoLabel')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {!isStaffModal && (
                <>
                  <TextInput
                    ref={nameInputRef}
                    style={[adminFormStyles.input, focusedField === 'nameHe' && adminFormStyles.inputFocused]}
                    placeholder={t('admin.nameHePh')}
                    value={admin.form.nameHe}
                    onChangeText={(tx) => admin.setForm((f) => ({ ...f, nameHe: tx }))}
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedField('nameHe')}
                    onBlur={() => setFocusedField(null)}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => nameArInputRef.current?.focus()}
                  />
                  <TextInput
                    ref={nameArInputRef}
                    style={[adminFormStyles.input, focusedField === 'nameAr' && adminFormStyles.inputFocused]}
                    placeholder={t('admin.nameArPh')}
                    value={admin.form.nameAr}
                    onChangeText={(tx) => admin.setForm((f) => ({ ...f, nameAr: tx }))}
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedField('nameAr')}
                    onBlur={() => setFocusedField(null)}
                    returnKeyType={admin.activeTab === 'services' ? 'next' : admin.activeTab === 'branches' ? 'next' : 'done'}
                    blurOnSubmit={admin.activeTab !== 'services' && admin.activeTab !== 'branches'}
                    onSubmitEditing={() => {
                      if (admin.activeTab === 'services') priceInputRef.current?.focus();
                      else if (admin.activeTab === 'branches') addressInputRef.current?.focus();
                      else Keyboard.dismiss();
                    }}
                  />
                </>
              )}
              {admin.activeTab === 'services' && (
                <View style={adminFormStyles.inlineRow}>
                  <TextInput
                    ref={priceInputRef}
                    style={[adminFormStyles.input, adminFormStyles.inputHalf, focusedField === 'price' && adminFormStyles.inputFocused]}
                    placeholder={t('admin.priceShekelPh')}
                    value={admin.form.price}
                    onChangeText={(tx) => admin.setForm((f) => ({ ...f, price: tx }))}
                    keyboardType="numeric"
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedField('price')}
                    onBlur={() => setFocusedField(null)}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => durationInputRef.current?.focus()}
                  />
                  <TextInput
                    ref={durationInputRef}
                    style={[adminFormStyles.input, adminFormStyles.inputHalf, focusedField === 'duration' && adminFormStyles.inputFocused]}
                    placeholder={t('admin.minutesPh')}
                    value={admin.form.duration}
                    onChangeText={(tx) => admin.setForm((f) => ({ ...f, duration: tx }))}
                    keyboardType="numeric"
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedField('duration')}
                    onBlur={() => setFocusedField(null)}
                    returnKeyType="done"
                    onSubmitEditing={() => Keyboard.dismiss()}
                  />
                </View>
              )}
              {admin.activeTab === 'branches' && (
                <>
                  <TextInput
                    ref={addressInputRef}
                    style={[adminFormStyles.input, focusedField === 'address' && adminFormStyles.inputFocused]}
                    placeholder={t('admin.addressPh')}
                    value={admin.form.address}
                    onChangeText={(tx) => admin.setForm((f) => ({ ...f, address: tx }))}
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedField('address')}
                    onBlur={() => setFocusedField(null)}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => wazeInputRef.current?.focus()}
                  />
                  <TextInput
                    ref={wazeInputRef}
                    style={[adminFormStyles.input, focusedField === 'waze' && adminFormStyles.inputFocused]}
                    placeholder={t('admin.wazePh')}
                    value={admin.form.wazeLink}
                    onChangeText={(tx) => admin.setForm((f) => ({ ...f, wazeLink: tx }))}
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedField('waze')}
                    onBlur={() => setFocusedField(null)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => branchPhoneInputRef.current?.focus()}
                  />
                  <TextInput
                    ref={branchPhoneInputRef}
                    style={[adminFormStyles.input, focusedField === 'branchPhone' && adminFormStyles.inputFocused]}
                    placeholder={t('admin.branchPhonePh')}
                    value={admin.form.branchPhone}
                    onChangeText={(tx) => admin.setForm((f) => ({ ...f, branchPhone: tx }))}
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedField('branchPhone')}
                    onBlur={() => setFocusedField(null)}
                    keyboardType="phone-pad"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => instagramInputRef.current?.focus()}
                  />
                  <TextInput
                    ref={instagramInputRef}
                    style={[adminFormStyles.input, focusedField === 'instagram' && adminFormStyles.inputFocused]}
                    placeholder={t('admin.instagramPh')}
                    value={admin.form.instagramUrl}
                    onChangeText={(tx) => admin.setForm((f) => ({ ...f, instagramUrl: tx }))}
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedField('instagram')}
                    onBlur={() => setFocusedField(null)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => googleMapsInputRef.current?.focus()}
                  />
                  <TextInput
                    ref={googleMapsInputRef}
                    style={[adminFormStyles.input, focusedField === 'googleMaps' && adminFormStyles.inputFocused]}
                    placeholder={t('admin.googleMapsPh')}
                    value={admin.form.googleMapsUrl}
                    onChangeText={(tx) => admin.setForm((f) => ({ ...f, googleMapsUrl: tx }))}
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedField('googleMaps')}
                    onBlur={() => setFocusedField(null)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="done"
                    onSubmitEditing={() => Keyboard.dismiss()}
                  />
                </>
              )}
              <View style={adminFormStyles.btns}>
                <AppButton
                  title={t('admin.cancel')}
                  variant="secondary"
                  onPress={() => {
                    resetStaffPhoto();
                    admin.setModalVisible(false);
                    admin.setEditItem(null);
                  }}
                />
                <AppButton
                  title={t('admin.save')}
                  variant="primary"
                  onPress={handleSave}
                  disabled={
                    (isStaffModal ? !admin.form.name.trim() : !admin.form.nameHe.trim() || !admin.form.nameAr.trim()) ||
                    admin.saving
                  }
                  loading={admin.saving}
                />
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <WheelTimePickerSheet
        visible={!!workdayTimePicker}
        title={workdayTimePicker?.field === 'end' ? t('admin.timeEnd') : t('admin.timeStart')}
        valueHHMM={
          workdayTimePicker
            ? getWorkdayDisplay(workdayTimePicker.staffId, workdayTimePicker.dayOfWeek, workdayTimePicker.field)
            : '09:00'
        }
        onRequestClose={() => setWorkdayTimePicker(null)}
        onConfirm={handleWorkdayTimePicked}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenWrap: { flex: 1 },
  denied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  deniedText: { ...typography.body, color: colors.textMuted, marginTop: spacing.md },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  loadingText: { ...typography.body, color: colors.textMuted },
  tabBarOuter: {
    backgroundColor: colors.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  tabBarScroll: {
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
  },
  /** Centers the pill group when tabs are narrower than the screen. */
  tabBarContent: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    minWidth: '100%',
    paddingVertical: 4,
    paddingHorizontal: 4,
    gap: 4,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
    flexShrink: 0,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: colors.accent,
    ...shadows.card,
  },
  tabText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'center',
    includeFontPadding: false,
  },
  tabTextActive: {
    color: colors.surface,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
  scroll: { flex: 1 },
  content: { ...presets.scrollContent },
  myStaffBadge: {
    backgroundColor: colors.accent + '22',
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    marginStart: spacing.sm,
    alignSelf: 'center',
  },
  myStaffBadgeText: { fontSize: 11, fontWeight: '700', color: colors.accent },
  addBtnCompact: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  addBtnCompactText: { color: colors.surface, fontSize: 15, fontWeight: '700' },
  staffReportHint: {
    ...textStyles.bodySmall,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.md,
    alignSelf: 'stretch',
  },
  staffRowPress: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  staffCard: {
    ...presets.card,
  },
  listItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  listItemRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  staffPermissionsLabel: {
    ...textStyles.caption,
    color: colors.textMuted,
    textAlign: 'right',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  staffPermissionsRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  permissionChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  permissionChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  permissionChipText: {
    ...textStyles.bodySmall,
    fontWeight: '600',
    color: colors.textMuted,
  },
  permissionChipTextActive: {
    color: colors.surface,
  },
  staffListAvatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  staffListAvatarImg: { width: '100%', height: '100%' },
  staffListAvatarPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listItemMain: { alignItems: 'flex-end', flex: 1, minWidth: 0 },
  listItemActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.md, marginStart: spacing.sm },
  deleteBtn: { padding: spacing.xs },
  listItemText: { ...textStyles.bodyMedium, textAlign: 'right' },
  listItemPhone: { ...textStyles.bodySmall, marginTop: spacing.xs, textAlign: 'right' },
  listItemSub: { ...textStyles.bodySmall, marginTop: spacing.xs, textAlign: 'right' },
  serviceCard: presets.card,
  catalogCard: {
    paddingVertical: 0,
    overflow: 'hidden',
  },
  serviceStaffSummary: { marginTop: 4, fontWeight: '600', color: colors.textSecondary },
  serviceCardHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  /** Title + subtitle only; chevron is serviceCardHeaderChevronBtn (far left with row-reverse). */
  serviceCardHeaderTouch: {
    flex: 1,
    minWidth: 0,
  },
  serviceCardHeaderContent: { flex: 1, minWidth: 0 },
  serviceCardHeaderChevronBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: 0,
    marginStart: -2,
  },
  serviceCardTitle: { ...textStyles.bodyMedium, textAlign: 'right' },
  serviceCardMeta: { ...textStyles.bodySmall, marginTop: spacing.xs, textAlign: 'right' },
  branchStaffLine: { marginTop: 4, fontWeight: '600', color: colors.textSecondary },
  serviceCardHeaderActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.md, flexShrink: 0 },
  serviceStaffSection: presets.expandableBody,
  serviceStaffSectionLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '600', marginBottom: spacing.sm, textAlign: 'right' },
  serviceStaffEmpty: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginBottom: spacing.sm, textAlign: 'right' },
  serviceStaffGroupedList: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  serviceStaffRowCard: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  serviceStaffRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  serviceStaffRowNameTop: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
    marginBottom: spacing.sm,
  },
  serviceStaffRowInputs: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  serviceStaffFieldGroup: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 120,
  },
  serviceStaffFieldLbl: { fontSize: 12, color: colors.textMuted, fontWeight: '700', width: 22, textAlign: 'center' },
  serviceStaffInputFlex: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    fontSize: 15,
    textAlign: 'center',
    backgroundColor: colors.background,
    minWidth: 56,
  },
  serviceStaffRemove: { padding: 8 },
  servicesHint: {
    ...textStyles.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
    textAlign: 'right',
  },
  branchStaffSection: presets.expandableBody,
  branchStaffLabel: { fontSize: 14, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.sm, textAlign: 'right' },
  branchStaffEmpty: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', textAlign: 'right' },
  branchStaffChips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-end' },
  branchStaffChip: { ...presets.chip, flexDirection: 'row-reverse' },
  branchStaffChipText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  branchStaffChipRemove: { padding: 2 },
  branchStaffAddBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.accent + '20',
    borderWidth: 1,
    borderColor: colors.accent,
    alignSelf: 'flex-start',
  },
  branchStaffAddText: { fontSize: 13, color: colors.accent, fontWeight: '600' },
  branchStaffPicker: { marginTop: spacing.sm, padding: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  branchStaffPickerItem: { padding: spacing.md, marginBottom: spacing.xs },
  branchStaffPickerText: { fontSize: 14, color: colors.text, textAlign: 'right' },
  workdaysPageTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'right',
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  workdaysHint: { ...textStyles.bodySmall, marginBottom: spacing.lg, textAlign: 'right', color: colors.textSecondary },
  workdaysCardExpanded: presets.cardExpanded,
  workdaysDayRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
  },
  workdaysDay: {
    minWidth: 62,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  workdaysDayActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  workdaysDayText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  workdaysDayTextActive: { color: colors.surface },
  workdaysTimesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    direction: 'ltr',
  },
  workdaysTimeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    minWidth: 60,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  workdaysTimeInputDisabled: { opacity: 0.55 },
  workdaysTimeInputText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  workdaysTimeSep: { fontSize: 14, color: colors.textMuted },
});

const adminFormStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdropTapTarget: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayScroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  content: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg + 2,
    ...shadows.cardStrong,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  title: { ...typography.titleSmall, marginBottom: spacing.lg, textAlign: 'right', fontSize: 20 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 3,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    marginBottom: spacing.md,
    textAlign: 'right',
    writingDirection: 'rtl',
    backgroundColor: colors.background,
  },
  inputTight: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    marginBottom: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
    backgroundColor: colors.background,
  },
  inputFocused: {
    borderColor: colors.accent,
    borderWidth: 2,
  },
  inputHalf: { flex: 1, marginBottom: 0 },
  inlineRow: { flexDirection: 'row-reverse', gap: spacing.sm, marginBottom: spacing.md },
  staffTopRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  staffFieldsCol: { flex: 1, minWidth: 0 },
  staffPhotoPreview: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surfaceMuted,
  },
  staffPhotoPlaceholder: { justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  staffPhotoActionsRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  staffPhotoPickBtnSm: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accent + '12',
  },
  staffPhotoPickTextSm: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  staffPhotoRemoveText: { color: colors.danger, fontWeight: '600', fontSize: 14 },
  btns: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.sm },
});
