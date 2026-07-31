import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Modal,
  Pressable,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
  StatusBar,
  type ImageStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { AppButton } from '../../components/ui/AppButton';
import { EmptyState } from '../../components/feedback/EmptyState';
import { useAuth } from '../../hooks/useAuth';
import { openDrawer } from '../../utils/nav';
import { prepareImageForUpload } from '../../utils/imageUpload';
import { colors, spacing, radius, textStyles, iconSize, layout, shadows } from '../../theme';
import { canAccessAdmin } from '../../lib/navigation.roles';
import {
  fetchAdminHomeStories,
  fetchMyHomeStories,
  deleteAdminHomeStory,
  deleteMyHomeStory,
  uploadSalonHomeStory,
  uploadStaffHomeStory,
  type HomeStoryItem,
  type AdminStoryRow,
} from '../../services/stories.api';
import { emitHomeStoryDeleted, emitHomeStoryUploaded } from '../../lib/homeStoriesUploadEvents';
import {
  readManagedHomeStoriesCache,
  warmManageStoriesImages,
  writeManagedHomeStoriesCache,
} from '../../services/homeStoriesCache';

const LOCAL_STORY_ID_PREFIX = 'local-';

function newLocalStoryId(): string {
  return `${LOCAL_STORY_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function HomeStoriesManageScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const route = useRoute();
  const params = route.params as { variant?: 'staff' | 'admin' } | undefined;
  const variant = params?.variant ?? 'staff';
  const { token, role, user, hasStaffProfile } = useAuth();
  const [rows, setRows] = useState<(HomeStoryItem | AdminStoryRow)[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingTempId, setUploadingTempId] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const isStaffVariant = variant === 'staff';

  const persistRows = useCallback(
    (nextRows: Array<HomeStoryItem | AdminStoryRow>) => {
      if (!token) return;
      const serverRows = nextRows.filter((row) => !row.id.startsWith(LOCAL_STORY_ID_PREFIX));
      void writeManagedHomeStoriesCache(token, variant, serverRows);
    },
    [token, variant],
  );

  useEffect(() => {
    if (!token) {
      (navigation.navigate as (n: string) => void)('Login');
      return;
    }
    if (isStaffVariant && !hasStaffProfile) {
      (navigation.navigate as (n: string) => void)('Home');
      return;
    }
    if (!isStaffVariant && !canAccessAdmin(role)) {
      (navigation.navigate as (n: string) => void)('Home');
    }
  }, [token, role, navigation, isStaffVariant, hasStaffProfile]);

  const load = useCallback(async () => {
    if (!token) return;
    const cached = await readManagedHomeStoriesCache(token, variant);
    const hadCached = !!cached?.length;
    if (cached && cached.length > 0) {
      setRows(cached);
      warmManageStoriesImages(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const list = isStaffVariant ? await fetchMyHomeStories(token) : await fetchAdminHomeStories(token);
      warmManageStoriesImages(list);
      setRows((prev) => {
        const locals = prev.filter((r) => r.id.startsWith(LOCAL_STORY_ID_PREFIX));
        const serverIds = new Set(list.map((r) => r.id));
        const keptLocals = locals.filter((l) => !serverIds.has(l.id));
        const nextRows = [...keptLocals, ...list.filter((s) => !keptLocals.some((l) => l.id === s.id))];
        persistRows(nextRows);
        return nextRows;
      });
    } catch {
      if (!hadCached) {
        setRows((prev) => prev.filter((r) => r.id.startsWith(LOCAL_STORY_ID_PREFIX)));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, variant, isStaffVariant, persistRows]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const pickAndUpload = async () => {
    if (!token || uploading) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('admin.permissionGallery'), t('stories.permissionGalleryMsg'));
      return;
    }
    // allowsEditing opens the OS crop sheet (small centered preview on iOS). Full library UI = full screen.
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.88,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const prepared = await prepareImageForUpload(asset.uri, asset.width, asset.height);
    const tempId = newLocalStoryId();
    const optimistic: HomeStoryItem = {
      id: tempId,
      imageUrl: prepared.uri,
      createdAt: new Date().toISOString(),
    };
    const displayName =
      `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || t('home.storiesStaffFallback');

    if (isStaffVariant) {
      setRows((prev) => {
        const nextRows = [optimistic, ...prev];
        persistRows(nextRows);
        return nextRows;
      });
      if (user?.staffId) {
        emitHomeStoryUploaded({
          variant: 'staff',
          story: optimistic,
          staffId: user.staffId,
          displayName,
        });
      }
    } else {
      const adminRow: AdminStoryRow = { ...optimistic, staffId: null, authorLabel: '' };
      setRows((prev) => {
        const nextRows = [adminRow, ...prev];
        persistRows(nextRows);
        return nextRows;
      });
      emitHomeStoryUploaded({ variant: 'salon', story: optimistic });
    }

    setUploading(true);
    setUploadingTempId(tempId);
    try {
      let created: HomeStoryItem;
      if (isStaffVariant) {
        created = await uploadStaffHomeStory(token, prepared.uri, prepared.mimeType);
        if (user?.staffId) {
          emitHomeStoryUploaded({
            variant: 'staff',
            story: created,
            staffId: user.staffId,
            displayName,
            replaceTempId: tempId,
          });
        }
        setRows((prev) => {
          const next = prev.filter((r) => r.id !== tempId && r.id !== created.id);
          const nextRows = [created, ...next];
          persistRows(nextRows);
          return nextRows;
        });
      } else {
        created = await uploadSalonHomeStory(token, prepared.uri, prepared.mimeType);
        emitHomeStoryUploaded({ variant: 'salon', story: created, replaceTempId: tempId });
        const adminRow: AdminStoryRow = { ...created, staffId: null, authorLabel: '' };
        setRows((prev) => {
          const next = prev.filter((r) => r.id !== tempId && r.id !== created.id);
          const nextRows = [adminRow, ...next];
          persistRows(nextRows);
          return nextRows;
        });
      }
    } catch (e) {
      emitHomeStoryDeleted(tempId);
      setRows((prev) => {
        const nextRows = prev.filter((r) => r.id !== tempId);
        persistRows(nextRows);
        return nextRows;
      });
      Alert.alert(t('common.error'), e instanceof Error ? e.message : t('common.tryAgain'));
    } finally {
      setUploading(false);
      setUploadingTempId(null);
    }
  };

  const remove = (id: string) => {
    if (!token) return;
    Alert.alert(t('stories.deleteConfirmTitle'), t('stories.deleteConfirmMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('stories.delete'),
        style: 'destructive',
        onPress: () => {
          let removed: HomeStoryItem | AdminStoryRow | null = null;
          setRows((prev) => {
            removed = prev.find((r) => r.id === id) ?? null;
            const nextRows = prev.filter((r) => r.id !== id);
            persistRows(nextRows);
            return nextRows;
          });
          emitHomeStoryDeleted(id);
          void (async () => {
            if (id.startsWith(LOCAL_STORY_ID_PREFIX)) return;
            try {
              if (isStaffVariant) await deleteMyHomeStory(token, id);
              else await deleteAdminHomeStory(token, id);
            } catch (e) {
              if (removed) {
                setRows((prev) => {
                  if (prev.some((r) => r.id === id)) return prev;
                  const nextRows = [removed as HomeStoryItem | AdminStoryRow, ...prev].sort(
                    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                  );
                  persistRows(nextRows);
                  return nextRows;
                });
              }
              Alert.alert(t('common.error'), e instanceof Error ? e.message : t('common.tryAgain'));
            }
          })();
        },
      },
    ]);
  };

  const title = isStaffVariant ? t('stories.staffTitle') : t('stories.adminTitle');

  return (
    <Screen style={styles.container} noPadding>
      <BlackHeader
        title={title}
        onBackPress={() =>
          isStaffVariant
            ? navigation.navigate('StaffDashboard')
            : navigation.navigate('Dashboard')
        }
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
        <Text style={styles.hint}>{t('stories.manageHint')}</Text>
        <AppButton
          title={uploading ? t('stories.uploading') : t('stories.addPhoto')}
          onPress={pickAndUpload}
          disabled={uploading}
          style={styles.uploadBtn}
        />

        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={styles.spinner} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('stories.emptyTitle')} message={t('stories.emptySub')} icon="images-outline" />
        ) : (
          <View style={styles.grid}>
            {rows.map((r) => {
              const meta = !isStaffVariant ? (r as AdminStoryRow) : null;
              const isLocalUploading = uploading && uploadingTempId === r.id;
              return (
                <View key={r.id} style={styles.tile}>
                  <Pressable
                    onPress={() => setPreviewUri(r.imageUrl)}
                    accessibilityRole="button"
                    accessibilityLabel={t('stories.viewPhotoA11y')}
                    style={styles.thumbPress}
                  >
                    <ExpoImage
                      source={{ uri: r.imageUrl }}
                      style={styles.thumb as ImageStyle}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={0}
                    />
                    {isLocalUploading ? (
                      <View style={styles.thumbUploadOverlay} pointerEvents="none">
                        <ActivityIndicator size="large" color={colors.accent} />
                      </View>
                    ) : null}
                  </Pressable>
                  {!isStaffVariant && meta ? (
                    <Text style={styles.meta} numberOfLines={1}>
                      {meta.staffId == null ? t('home.storiesSalonName') : meta.authorLabel}
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    style={styles.trash}
                    onPress={() => remove(r.id)}
                    hitSlop={8}
                    disabled={uploading}
                    accessibilityRole="button"
                    accessibilityLabel={t('stories.delete')}
                    accessibilityState={{ disabled: uploading }}
                  >
                    <Ionicons name="trash-outline" size={iconSize.sm} color={uploading ? colors.textMuted : colors.danger} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
        </ScreenEnter>
      </ScrollView>

      <Modal
        visible={previewUri != null}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={() => setPreviewUri(null)}
      >
        <View style={styles.previewRoot}>
          <StatusBar barStyle="light-content" backgroundColor="#000" translucent />
          <Pressable
            style={styles.previewBackdrop}
            onPress={() => setPreviewUri(null)}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            {previewUri ? (
              <ExpoImage
                source={{ uri: previewUri }}
                style={styles.previewImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={0}
              />
            ) : null}
          </Pressable>
          <Pressable
            onPress={() => setPreviewUri(null)}
            style={[styles.previewClose, { top: insets.top + spacing.sm, end: spacing.md }]}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            hitSlop={12}
          >
            <View style={styles.previewCloseInner}>
              <Ionicons name="close" size={26} color="#fff" />
            </View>
          </Pressable>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.md,
  },
  hint: {
    ...textStyles.bodySmall,
    textAlign: 'right',
    marginBottom: spacing.md,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  uploadBtn: { marginBottom: spacing.lg },
  spinner: { marginTop: spacing.xl },
  grid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: {
    width: '47%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  thumbPress: {
    width: '100%',
  },
  thumb: {
    width: '100%',
    aspectRatio: 9 / 16,
    backgroundColor: colors.surfaceMuted,
  },
  thumbUploadOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  meta: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'right',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    writingDirection: 'rtl',
  },
  trash: {
    position: 'absolute',
    top: spacing.sm,
    end: spacing.sm,
    zIndex: 2,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.full,
    padding: 6,
  },
  previewRoot: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewClose: {
    position: 'absolute',
    zIndex: 3,
  },
  previewCloseInner: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.full,
    padding: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
});
