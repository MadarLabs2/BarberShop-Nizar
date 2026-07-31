import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { PageIntro } from '../../components/ui/PageIntro';
import { EmptyState } from '../../components/feedback/EmptyState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { AppButton } from '../../components/ui/AppButton';
import { useAuth } from '../../hooks/useAuth';
import { useStaffOperationalSurface } from '../../hooks/useStaffOperationalSurface';
import { openDrawer } from '../../utils/nav';
import { colors, spacing, radius, presets, shadows, textStyles, iconSize, layout } from '../../theme';
import {
  getStaffWaitlist,
  getMyStaffAppointments,
  cancelStaffWaitlistEntry,
  createBroadcastWaitlistForMyStaff,
  type StaffWaitlistRow,
} from '../../services/admin.api';
import { setStaffAppointmentsCache } from '../../services/staffPrefetchCache';
import {
  getCachedStaffWaitlistRows,
  setCachedStaffWaitlistRows,
} from '../../services/adminPrefetchCache';
import { localizeCatalogString, useAppLocale } from '../../contexts/LocaleContext';
import { formatDateDmy } from '../../utils/dates';
import type { TFunction } from 'i18next';

function prefsLabel(row: StaffWaitlistRow, tr: TFunction): string {
  const parts: string[] = [];
  if (row.preferMorning) parts.push(tr('appointments.morning'));
  if (row.preferAfternoon) parts.push(tr('appointments.afternoon'));
  if (row.preferEvening) parts.push(tr('appointments.evening'));
  return parts.length ? parts.join(' · ') : tr('booking.dash');
}

export function StaffWaitlistScreen() {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const { token } = useAuth();
  const staffSurfaceOk = useStaffOperationalSurface();
  const [rows, setRows] = useState<StaffWaitlistRow[]>(() => getCachedStaffWaitlistRows() ?? []);
  const [loading, setLoading] = useState(() => getCachedStaffWaitlistRows() === null);
  const [refreshing, setRefreshing] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [broadcastModalVisible, setBroadcastModalVisible] = useState(false);
  const [broadcastForm, setBroadcastForm] = useState({ title: '', body: '' });
  const [broadcastSaving, setBroadcastSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const hadCache = getCachedStaffWaitlistRows() !== null;
    if (!hadCache) setLoading(true);
    try {
      const data = await getStaffWaitlist(token);
      setCachedStaffWaitlistRows(data);
      setRows(data);
    } catch {
      if (!hadCache) setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  const requestRemoveRow = useCallback(
    (row: StaffWaitlistRow) => {
      if (!token || removingId) return;
      Alert.alert(t('admin.waitlistRemoveTitle'), t('admin.waitlistRemoveBody', { name: row.clientName }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.waitlistRemoveAction'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setRemovingId(row.id);
              try {
                await cancelStaffWaitlistEntry(token, row.id);
                setRows((prev) => {
                  const next = prev.filter((r) => r.id !== row.id);
                  setCachedStaffWaitlistRows(next);
                  return next;
                });
              } catch (e) {
                Alert.alert(t('common.error'), e instanceof Error ? e.message : t('admin.waitlistRemoveFailed'));
              } finally {
                setRemovingId(null);
              }
            })();
          },
        },
      ]);
    },
    [token, removingId, t],
  );

  const sendWaitlistMessage = useCallback(async () => {
    if (!token || !broadcastForm.title.trim()) return;
    setBroadcastSaving(true);
    try {
      const result = await createBroadcastWaitlistForMyStaff(
        token,
        broadcastForm.title.trim(),
        broadcastForm.body.trim() || undefined,
      );
      setBroadcastModalVisible(false);
      setBroadcastForm({ title: '', body: '' });
      Alert.alert(
        t('admin.success'),
        result.queued === 0
          ? t('admin.broadcastWaitlistNone')
          : t('admin.broadcastWaitlistQueued', { count: result.queued }),
      );
    } catch (e) {
      Alert.alert(t('admin.error'), e instanceof Error ? e.message : t('admin.sendBroadcastFailed'));
    } finally {
      setBroadcastSaving(false);
    }
  }, [token, broadcastForm.title, broadcastForm.body, t]);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      if (!staffSurfaceOk) {
        navigation.navigate('Home' as never);
        return;
      }
      const snap = getCachedStaffWaitlistRows();
      if (snap !== null) {
        setRows(snap);
        setLoading(false);
      } else {
        setLoading(true);
      }
      void load();
      return () => {
        if (token) {
          void getMyStaffAppointments(token)
            .then((list) => setStaffAppointmentsCache(list))
            .catch(() => {});
        }
      };
    }, [token, navigation, load, staffSurfaceOk]),
  );

  /** Admin + linked staff: stay on staff waitlist (`/admin/waitlist/my-staff`), not admin-wide list. */
  if (!token || !staffSurfaceOk) {
    return null;
  }

  return (
    <Screen style={styles.container} noPadding>
      <BlackHeader
        title={t('staff.waitlistTitle')}
        onBackPress={() => navigation.navigate('StaffDashboard')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        showsVerticalScrollIndicator={false}
      >
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
        <PageIntro title={t('staff.waitlistPageTitle')} />
        <Text style={styles.intro}>{t('staff.waitlistIntro')}</Text>
        <View style={styles.messageBtnRow}>
          <TouchableOpacity
            style={styles.messageBtn}
            onPress={() => setBroadcastModalVisible(true)}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={t('staff.waitlistBroadcastTitle')}
            accessibilityHint={t('staff.waitlistBroadcastSub')}
          >
            <Ionicons name="megaphone-outline" size={iconSize.sm} color={colors.onPrimary} />
            <Text style={styles.messageBtnLabel} numberOfLines={1}>
              {t('staff.waitlistBroadcastTitle')}
            </Text>
          </TouchableOpacity>
        </View>
        {loading && rows.length === 0 ? (
          <View style={styles.centered}>
            <LoadingState />
          </View>
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('staff.waitlistEmptyTitle')}
            message={t('staff.waitlistEmptyMsg')}
            icon="people-outline"
          />
        ) : (
          rows.map((row) => (
            <View key={row.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.name}>{row.clientName}</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {formatDateDmy(new Date(row.date + 'T12:00:00'))}
                  </Text>
                </View>
              </View>
              <Text style={styles.line}>{localizeCatalogString(row.serviceName, locale)}</Text>
              {row.branchName ? (
                <Text style={styles.muted}>{localizeCatalogString(row.branchName, locale)}</Text>
              ) : null}
              <View style={styles.prefs}>
                <Ionicons name="sunny-outline" size={iconSize.sm} color={colors.accent} />
                <Text style={styles.prefsText}>{prefsLabel(row, t)}</Text>
              </View>
              <Text style={styles.phone}>{row.clientPhone}</Text>
              <TouchableOpacity
                style={[styles.removeWaitlistBtn, removingId === row.id && styles.removeWaitlistBtnDisabled]}
                onPress={() => requestRemoveRow(row)}
                disabled={!!removingId}
                activeOpacity={0.75}
              >
                <Text style={styles.removeWaitlistBtnText}>{t('admin.waitlistRemoveFromList')}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
        </ScreenEnter>
      </ScrollView>

      <Modal visible={broadcastModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <Pressable style={styles.modalBackdrop} onPress={Keyboard.dismiss} accessibilityRole="button" />
          <View style={styles.modalCardWrap} pointerEvents="box-none">
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{t('staff.waitlistBroadcastTitle')}</Text>
              <Text style={styles.modalHint}>{t('staff.waitlistBroadcastHint')}</Text>
              <Text style={styles.modalLabel}>{t('admin.titlePlaceholder')}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('admin.titlePlaceholder')}
                value={broadcastForm.title}
                onChangeText={(v) => setBroadcastForm((f) => ({ ...f, title: v }))}
                placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.modalLabel}>{t('admin.labelBodyOptional')}</Text>
              <TextInput
                style={[styles.modalInput, styles.modalInputArea]}
                placeholder={t('admin.bodyPlaceholder')}
                value={broadcastForm.body}
                onChangeText={(v) => setBroadcastForm((f) => ({ ...f, body: v }))}
                placeholderTextColor={colors.textMuted}
                multiline
                textAlignVertical="top"
              />
              <View style={styles.modalBtns}>
                <AppButton
                  title={t('admin.cancel')}
                  variant="secondary"
                  onPress={() => setBroadcastModalVisible(false)}
                />
                <AppButton
                  title={t('admin.send')}
                  variant="primary"
                  onPress={sendWaitlistMessage}
                  disabled={!broadcastForm.title.trim() || broadcastSaving}
                  loading={broadcastSaving}
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: presets.scrollContent,
  intro: {
    ...textStyles.bodySmall,
    textAlign: 'right',
    marginBottom: spacing.sm,
  },
  /** RTL: align pill to logical start (right). */
  messageBtnRow: {
    alignSelf: 'flex-end',
    marginBottom: spacing.md,
    maxWidth: '100%',
  },
  messageBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    ...shadows.card,
  },
  messageBtnLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.onPrimary,
    textAlign: 'right',
    writingDirection: 'rtl',
    flexShrink: 1,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenPaddingH,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  modalCardWrap: {
    width: '100%',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  modalTitle: {
    ...textStyles.sectionTitle,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.xs,
  },
  modalHint: {
    ...textStyles.bodySmall,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.md,
  },
  modalLabel: {
    ...textStyles.bodySmall,
    color: colors.textSecondary,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.xs,
  },
  modalInput: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.md,
  },
  modalInputArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  modalBtns: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  centered: { paddingVertical: spacing.xl * 2, alignItems: 'center', minHeight: 160 },
  card: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  name: { ...textStyles.sectionTitle, fontSize: 17, marginBottom: 0, flex: 1, textAlign: 'right' },
  badge: { backgroundColor: colors.accent + '22', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.md },
  badgeText: { ...textStyles.caption, fontWeight: '700', color: colors.accent },
  line: { ...textStyles.bodyMedium, fontSize: 15, textAlign: 'right', marginBottom: spacing.xs },
  muted: { ...textStyles.bodySmall, textAlign: 'right', marginBottom: spacing.sm },
  prefs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs, marginTop: spacing.xs },
  prefsText: { ...textStyles.bodySmall, color: colors.text, fontWeight: '600' },
  phone: { ...textStyles.bodySmall, textAlign: 'right', marginTop: spacing.sm, direction: 'ltr' as const },
  removeWaitlistBtn: {
    marginTop: spacing.md,
    alignSelf: 'flex-end',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerMuted,
  },
  removeWaitlistBtnDisabled: { opacity: 0.55 },
  removeWaitlistBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.danger,
    textAlign: 'right',
  },
});
