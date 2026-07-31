import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Image,
  Pressable,
  Keyboard,
  type ImageStyle,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { AppButton } from '../../components/ui/AppButton';
import { EmptyState } from '../../components/feedback/EmptyState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Keyed } from '../../components/ui/Keyed';
import { useAuth } from '../../hooks/useAuth';
import { useAdminProducts } from '../../hooks/useAdminProducts';
import { uploadProductImage } from '../../services/admin.api';
import { openDrawer } from '../../utils/nav';
import { validateName, validateServicePrice } from '../../utils/validators';
import { prepareImageForUpload } from '../../utils/imageUpload';
import { colors, spacing, typography, radius, shadows, textStyles, iconSize, layout } from '../../theme';
import { canAccessAdmin } from '../../lib/navigation.roles';

type FieldKey = 'name' | 'description' | 'price' | 'category' | 'stock';

export function AdminProductsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const insets = useSafeAreaInsets();
  const { token, role } = useAuth();
  const p = useAdminProducts(token);

  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [pickedMime, setPickedMime] = useState<string | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [focusedField, setFocusedField] = useState<FieldKey | null>(null);

  const resetImageState = useCallback(() => {
    setPickedUri(null);
    setPickedMime(null);
    setImageRemoved(false);
  }, []);

  const openAddWrapped = useCallback(() => {
    resetImageState();
    setFocusedField(null);
    p.openAdd();
  }, [p, resetImageState]);

  const openEditWrapped = useCallback(
    (item: Parameters<typeof p.openEdit>[0]) => {
      resetImageState();
      setFocusedField(null);
      p.openEdit(item);
    },
    [p, resetImageState]
  );

  const closeModalWrapped = useCallback(() => {
    Keyboard.dismiss();
    resetImageState();
    setFocusedField(null);
    p.closeModal();
  }, [p, resetImageState]);

  const pickFromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('admin.permissionGallery'), t('admin.permissionGalleryMsg'));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const prepared = await prepareImageForUpload(asset.uri, asset.width, asset.height);
    setPickedUri(prepared.uri);
    setPickedMime(prepared.mimeType);
    setImageRemoved(false);
  };

  const removeImage = () => {
    setPickedUri(null);
    setPickedMime(null);
    setImageRemoved(true);
    p.setForm((f) => ({ ...f, imageUrl: '' }));
  };

  const previewSource = pickedUri
    ? { uri: pickedUri }
    : !imageRemoved && p.form.imageUrl.trim()
      ? { uri: p.form.imageUrl.trim() }
      : null;

  const confirmDelete = (id: string, name: string) => {
    Alert.alert(t('admin.deleteProductTitle'), t('admin.deleteProductMsg', { name }), [
      { text: t('admin.cancel'), style: 'cancel' },
      {
        text: t('admin.delete'),
        style: 'destructive',
        onPress: async () => {
          const r = await p.handleDelete(id);
          if (r?.error) Alert.alert(t('admin.error'), r.error);
        },
      },
    ]);
  };

  const submit = async () => {
    if (!token) return;
    const nameResult = validateName(p.form.name, t('admin.validateProductName'));
    if (!nameResult.valid) {
      Alert.alert(t('admin.error'), nameResult.error);
      return;
    }
    const priceResult = validateServicePrice(p.form.price);
    if (!priceResult.valid) {
      Alert.alert(t('admin.error'), priceResult.error);
      return;
    }
    const stockRaw = p.form.stockQuantity.trim();
    const stock = Math.max(0, Math.floor(parseInt(stockRaw, 10) || 0));
    const price = Math.max(0, Math.floor(parseInt(p.form.price, 10) || 0));
    const saleRaw = p.form.salePrice.trim();
    let salePrice: number | null | undefined;
    if (p.editItem) {
      if (saleRaw === '') {
        salePrice = null;
      } else {
        const sp = Math.max(0, Math.floor(parseInt(saleRaw, 10) || 0));
        if (sp >= price) {
          Alert.alert(t('admin.error'), t('admin.salePriceInvalid'));
          return;
        }
        salePrice = sp;
      }
    } else if (saleRaw !== '') {
      const sp = Math.max(0, Math.floor(parseInt(saleRaw, 10) || 0));
      if (sp >= price) {
        Alert.alert(t('admin.error'), t('admin.salePriceInvalid'));
        return;
      }
      salePrice = sp;
    } else {
      salePrice = undefined;
    }

    let finalImage: string | null | undefined;
    try {
      if (pickedUri) {
        setUploadBusy(true);
        finalImage = await uploadProductImage(token, pickedUri, pickedMime);
      } else if (p.editItem && imageRemoved) {
        finalImage = null;
      } else if (p.editItem) {
        finalImage = p.form.imageUrl.trim() || null;
      } else {
        finalImage = p.form.imageUrl.trim() || undefined;
      }
    } catch (e) {
      Alert.alert(t('admin.error'), e instanceof Error ? e.message : t('admin.uploadFailed'));
      return;
    } finally {
      setUploadBusy(false);
    }

    Keyboard.dismiss();
    const r = await p.handleSave({
      name: p.form.name.trim(),
      description: p.form.description.trim() || undefined,
      price,
      ...(p.editItem ? { salePrice: salePrice as number | null } : {}),
      ...(!p.editItem && salePrice !== undefined ? { salePrice } : {}),
      imageUrl: finalImage,
      category: p.form.category.trim() || undefined,
      stockQuantity: stock,
      isActive: p.form.isActive,
    });
    if (r?.error) Alert.alert(t('admin.error'), r.error);
    else resetImageState();
  };

  if (!token || !canAccessAdmin(role)) {
    return null;
  }

  if (p.loading) {
    return (
      <Screen style={styles.screenWrap} noPadding>
        <BlackHeader title={t('admin.productsTitle')} onBackPress={() => navigation.navigate('Dashboard')} onMenuPress={() => openDrawer(navigation)} />
        <LoadingState />
      </Screen>
    );
  }

  const keyboardOffset = Platform.OS === 'ios' ? 8 : 0;

  const inputStyle = (key: FieldKey) => [
    styles.input,
    focusedField === key && styles.inputFocused,
  ];

  return (
    <Screen style={styles.screenWrap} noPadding>
      <BlackHeader title={t('admin.productsTitle')} onBackPress={() => navigation.navigate('Dashboard')} onMenuPress={() => openDrawer(navigation)} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={p.refreshing} onRefresh={p.onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
        <TouchableOpacity style={styles.addBtnCompact} onPress={openAddWrapped} activeOpacity={0.88}>
          <Ionicons name="add" size={20} color={colors.surface} />
          <Text style={styles.addBtnCompactText}>{t('admin.addProduct')}</Text>
        </TouchableOpacity>

        {p.products.length === 0 ? (
          <EmptyState title={t('admin.productsEmptyTitle')} message={t('admin.productsEmptyMsg')} icon="cube-outline" />
        ) : (
          p.products.map((item) => (
            <Keyed key={item.id}>
              <View style={[styles.card, !item.isActive && styles.cardInactive]}>
                <View style={styles.cardMain}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  {item.category ? <Text style={styles.cardMeta}>{item.category}</Text> : null}
                  <Text style={styles.cardMeta}>
                    {item.salePrice != null && item.salePrice < item.price
                      ? t('admin.productPriceSaleLine', {
                          price: item.price,
                          sale: item.salePrice,
                          qty: item.stockQuantity,
                        })
                      : t('admin.productPriceStockLine', { price: item.price, qty: item.stockQuantity })}
                    {!item.isActive ? t('admin.inactiveSuffix') : ''}
                  </Text>
                </View>
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    onPress={() => openEditWrapped(item)}
                    disabled={p.deletingId === item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('admin.productEdit')}: ${item.name}`}
                  >
                    <Ionicons name="create-outline" size={iconSize.lg} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => confirmDelete(item.id, item.name)}
                    style={styles.deleteBtn}
                    disabled={!!p.deletingId}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('admin.delete')}: ${item.name}`}
                    accessibilityState={{ disabled: !!p.deletingId, busy: p.deletingId === item.id }}
                  >
                    {p.deletingId === item.id ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <Ionicons name="trash-outline" size={iconSize.md} color={colors.danger} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </Keyed>
          ))
        )}
        </ScreenEnter>
      </ScrollView>

      <Modal visible={p.modalVisible} animationType="slide" transparent onRequestClose={closeModalWrapped}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeModalWrapped} />
          <KeyboardAvoidingView
            style={styles.modalKav}
            behavior={Platform.OS === 'ios' ? 'position' : undefined}
            keyboardVerticalOffset={keyboardOffset}
          >
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
              <View style={styles.modalGrabber} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{p.editItem ? t('admin.productEdit') : t('admin.productNew')}</Text>
                <Text style={styles.modalSubtitle}>{t('admin.productModalSub')}</Text>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalScrollContent}
                nestedScrollEnabled
              >
                <Text style={styles.sectionLabel}>{t('admin.sectionImage')}</Text>
                <View style={styles.imageSection}>
                  {previewSource ? (
                    <Image source={previewSource} style={styles.imagePreview as ImageStyle} resizeMode="cover" />
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <Ionicons name="image-outline" size={32} color={colors.textTertiary} />
                      <Text style={styles.imagePlaceholderText}>{t('admin.noImageYet')}</Text>
                    </View>
                  )}
                  <View style={styles.imageActions}>
                    <TouchableOpacity style={styles.imagePickBtnOutline} onPress={pickFromGallery} disabled={uploadBusy || p.saving} activeOpacity={0.85}>
                      <Ionicons name="images-outline" size={iconSize.sm} color={colors.accent} />
                      <Text style={styles.imagePickBtnOutlineText}>{t('admin.imagePickGallery')}</Text>
                    </TouchableOpacity>
                    {(previewSource || p.editItem?.imageUrl) && (
                      <TouchableOpacity onPress={removeImage} disabled={uploadBusy || p.saving} hitSlop={{ top: 8, bottom: 8 }}>
                        <Text style={styles.imageRemoveText}>{t('admin.removeShort')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                <Text style={styles.sectionLabel}>{t('admin.sectionNameDesc')}</Text>
                <TextInput
                  style={inputStyle('name')}
                  value={p.form.name}
                  onChangeText={(v) => p.setForm((f) => ({ ...f, name: v }))}
                  placeholder={t('admin.productNamePh')}
                  placeholderTextColor={colors.textTertiary}
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                  textAlign="right"
                  returnKeyType="next"
                />
                <TextInput
                  style={[inputStyle('description'), styles.inputMultiline]}
                  value={p.form.description}
                  onChangeText={(v) => p.setForm((f) => ({ ...f, description: v }))}
                  placeholder={t('admin.productDescPh')}
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  onFocus={() => setFocusedField('description')}
                  onBlur={() => setFocusedField(null)}
                  textAlign="right"
                  textAlignVertical="top"
                />

                <Text style={styles.sectionLabel}>{t('admin.sectionPriceStock')}</Text>
                <View style={styles.inlineRow}>
                  <View style={styles.inlineHalf}>
                    <Text style={styles.inlineHint}>{t('admin.priceNisLabel')}</Text>
                    <TextInput
                      style={inputStyle('price')}
                      value={p.form.price}
                      onChangeText={(v) => p.setForm((f) => ({ ...f, price: v }))}
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="number-pad"
                      onFocus={() => setFocusedField('price')}
                      onBlur={() => setFocusedField(null)}
                      textAlign="right"
                    />
                  </View>
                  <View style={styles.inlineHalf}>
                    <Text style={styles.inlineHint}>{t('admin.stockQtyLabel')}</Text>
                    <TextInput
                      style={inputStyle('stock')}
                      value={p.form.stockQuantity}
                      onChangeText={(v) => p.setForm((f) => ({ ...f, stockQuantity: v }))}
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="number-pad"
                      onFocus={() => setFocusedField('stock')}
                      onBlur={() => setFocusedField(null)}
                      textAlign="right"
                    />
                  </View>
                </View>

                <Text style={styles.sectionLabel}>{t('admin.salePriceSection')}</Text>
                <Text style={styles.inlineHint}>{t('admin.salePriceHint')}</Text>
                <TextInput
                  style={inputStyle('price')}
                  value={p.form.salePrice}
                  onChangeText={(v) => p.setForm((f) => ({ ...f, salePrice: v.replace(/[^\d]/g, '') }))}
                  placeholder={t('admin.salePricePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  textAlign="right"
                />

                <Text style={styles.sectionLabel}>{t('admin.categorySection')}</Text>
                <TextInput
                  style={inputStyle('category')}
                  value={p.form.category}
                  onChangeText={(v) => p.setForm((f) => ({ ...f, category: v }))}
                  placeholder={t('admin.categoryPh')}
                  placeholderTextColor={colors.textTertiary}
                  onFocus={() => setFocusedField('category')}
                  onBlur={() => setFocusedField(null)}
                  textAlign="right"
                />

                {p.editItem ? (
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>{t('admin.shownToCustomers')}</Text>
                    <Switch
                      value={p.form.isActive}
                      onValueChange={(v) => p.setForm((f) => ({ ...f, isActive: v }))}
                      trackColor={{ false: colors.border, true: colors.accent }}
                      thumbColor={colors.surface}
                    />
                  </View>
                ) : null}
              </ScrollView>

              <View style={styles.modalFooter}>
                <AppButton title={t('admin.cancel')} onPress={closeModalWrapped} variant="secondary" style={styles.modalBtn} disabled={p.saving || uploadBusy} />
                <AppButton
                  title={t('admin.save')}
                  onPress={submit}
                  variant="primary"
                  style={styles.modalBtn}
                  disabled={p.saving || uploadBusy}
                  loading={p.saving || uploadBusy}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenWrap: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
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
  card: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  cardInactive: { opacity: 0.65 },
  cardMain: { flex: 1, paddingStart: spacing.sm, minWidth: 0 },
  cardTitle: { ...textStyles.bodyMedium, color: colors.text, textAlign: 'right' },
  cardMeta: { ...textStyles.bodySmall, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'right' },
  cardActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.md },
  deleteBtn: { padding: spacing.xs },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  modalKav: {
    width: '100%',
    maxHeight: Platform.OS === 'ios' ? '94%' : '96%',
  },
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
  modalHeader: { marginBottom: spacing.md },
  modalTitle: { ...textStyles.sectionTitle, textAlign: 'right', marginBottom: spacing.xs },
  modalSubtitle: { ...textStyles.bodySmall, color: colors.textTertiary, textAlign: 'right' },
  modalScrollContent: {
    paddingBottom: spacing.lg,
  },
  sectionLabel: {
    ...textStyles.label,
    fontSize: 12,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    color: colors.text,
    marginBottom: spacing.md,
    fontSize: 16,
    minHeight: 48,
    textAlign: 'right',
  },
  inputFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  inputMultiline: { minHeight: 88, paddingTop: Platform.OS === 'ios' ? 14 : 12 },
  imageSection: { marginBottom: spacing.sm },
  imagePreview: {
    width: '100%',
    height: 132,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  imagePlaceholder: {
    width: '100%',
    height: 112,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderStyle: 'dashed',
  },
  imagePlaceholderText: { ...typography.caption, color: colors.textTertiary },
  imageActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  imagePickBtnOutline: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.accent + '12',
  },
  imagePickBtnOutlineText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  imageRemoveText: { color: colors.danger, fontWeight: '600', fontSize: 14 },
  inlineRow: {
    flexDirection: 'row-reverse',
    gap: spacing.md,
    marginBottom: 0,
  },
  inlineHalf: { flex: 1, minWidth: 0 },
  inlineHint: {
    ...textStyles.caption,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
    textAlign: 'right',
  },
  switchRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
  },
  switchLabel: { ...textStyles.bodyMedium, color: colors.text, flex: 1, textAlign: 'right' },
  modalFooter: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  modalBtn: { flex: 1, minHeight: 48, paddingVertical: 12 },
});
